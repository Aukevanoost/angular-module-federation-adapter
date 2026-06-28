import * as esbuild from 'esbuild';
import * as path from 'path';
import { createRequire } from 'node:module';

import {
  transformSupportedBrowsersToTargets,
  getSupportedBrowsers,
  generateSearchDirectories,
  findTailwindConfiguration,
  loadPostcssConfiguration,
  type BundleStylesheetOptions,
  type CompilerPluginOptions,
} from '@angular/build/private';

import { normalizeOptimization, normalizeSourceMaps } from '../../utils/normalize-build-options.js';

import { createAwaitableCompilerPlugin } from './create-awaitable-compiler-plugin.js';
import type { NormalizedContextOptions } from '../../utils/normalize-context-options.js';
import { updateFederationTsConfig } from './create-federation-tsconfig.js';

export async function createAngularEsbuildContext(
  options: NormalizedContextOptions,
  // `extraPlugins`: appended after the Angular compiler — the MF side build (M2.1)
  // injects `moduleFederationPlugin` here (one-pass composition).
  // `write`: defaults to `false` (NF's adapter wrote outputs itself via writeResult).
  // The MF side build MUST set `true` (M2.2): the plugin's `onEnd` reads the
  // emitted container off disk (`fs.readFileSync`) to inject the module map, so it
  // does not honor `write:false`.
  extra: { extraPlugins?: esbuild.Plugin[]; write?: boolean } = {}
): Promise<{
  ctx: esbuild.BuildContext;
  pluginDisposed: Promise<void>;
}> {
  const {
    builderOptions,
    context,
    entryPoints,
    external,
    outdir,
    cache,
    dev,
    hash,
    chunks,
    platform,
    optimizedMappings,
  } = options;

  let tsConfigPath = options.tsConfigPath;

  if (!tsConfigPath) {
    throw new Error('tsConfigPath is required for Angular/esbuild context creation');
  }

  const workspaceRoot = context.workspaceRoot;

  const projectMetadata = await context.getProjectMetadata(context.target!.project);
  const projectRoot = path.join(
    workspaceRoot,
    (projectMetadata['root'] as string | undefined) ?? ''
  );

  const browsers = getSupportedBrowsers(projectRoot, context.logger as unknown as Console);
  const target = transformSupportedBrowsersToTargets(browsers);

  const optimizationOptions = normalizeOptimization(builderOptions.optimization);
  const sourcemapOptions = normalizeSourceMaps(builderOptions.sourceMap!);

  const searchDirectories = await generateSearchDirectories([projectRoot, workspaceRoot]);
  const postcssConfiguration = await loadPostcssConfiguration(searchDirectories);
  const tailwindConfiguration = postcssConfiguration
    ? undefined
    : await getTailwindConfig(searchDirectories);

  const outputNames = {
    bundles: '[name]',
    media: 'media/[name]',
  };

  let fileReplacements: Record<string, string> | undefined;
  if (builderOptions.fileReplacements) {
    for (const replacement of builderOptions.fileReplacements) {
      fileReplacements ??= {};
      fileReplacements[path.join(workspaceRoot, replacement.replace)] = path.join(
        workspaceRoot,
        replacement.with
      );
    }
  }

  if (optimizedMappings) {
    updateFederationTsConfig(workspaceRoot, tsConfigPath, entryPoints);
  }

  tsConfigPath = path.join(workspaceRoot, tsConfigPath);

  const pluginOptions: CompilerPluginOptions = {
    sourcemap: !!sourcemapOptions.scripts && (sourcemapOptions.hidden ? 'external' : true),
    thirdPartySourcemaps: sourcemapOptions.vendor,
    tsconfig: tsConfigPath,
    jit: false,
    advancedOptimizations: !dev,
    fileReplacements,
    sourceFileCache: cache.bundlerCache,
    loadResultCache: cache.bundlerCache.loadResultCache,
    incremental: true,
    includeTestMetadata: !optimizationOptions.scripts,
    instrumentForCoverage: builderOptions.instrumentForCoverage,
  };

  const stylesheetBundlerOptions: BundleStylesheetOptions & { inlineStyleLanguage: string } = {
    workspaceRoot,
    inlineFonts: !!optimizationOptions.fonts.inline,
    optimization: !!optimizationOptions.styles.minify,
    sourcemap:
      // Hidden component stylesheet sourcemaps are inaccessible which is effectively
      // the same as being disabled. Disabling has the advantage of avoiding the overhead
      // of sourcemap processing.
      sourcemapOptions.styles && !sourcemapOptions.hidden ? 'linked' : false,
    outputNames,
    includePaths: builderOptions.stylePreprocessorOptions?.includePaths,
    sass: builderOptions?.stylePreprocessorOptions?.sass as BundleStylesheetOptions['sass'],
    externalDependencies: external,
    target,
    inlineStyleLanguage: builderOptions.inlineStyleLanguage ?? 'css',
    preserveSymlinks: builderOptions.preserveSymlinks,
    tailwindConfiguration,
    postcssConfiguration,
    cacheOptions: {
      enabled: true,
      basePath: cache.cachePath,
      path: cache.cachePath,
    },
  };

  const commonjsPluginModule = await import('@chialab/esbuild-plugin-commonjs');
  const commonjsPlugin = commonjsPluginModule.default;

  stylesheetBundlerOptions.externalDependencies = [];

  const [compilerPlugin, pluginDisposed] = createAwaitableCompilerPlugin(
    pluginOptions,
    stylesheetBundlerOptions
  );

  const customPlugins = Array.isArray(options.builderOptions.plugins)
    ? options.builderOptions.plugins
    : [];

  const config: esbuild.BuildOptions = {
    entryPoints: entryPoints.map(ep => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    write: extra.write ?? false,
    external,
    logLevel: 'warning',
    bundle: true,
    sourcemap: sourcemapOptions.scripts,
    minify: !dev,
    supported: {
      // Never set `'async-await': false`: the MF v2 container and
      // `virtual-share-module:*` wrappers emit top-level await, which esbuild
      // cannot downlevel when async/await is marked unsupported.
      'object-rest-spread': false,
      'top-level-await': true,
    },
    splitting: chunks,
    platform: platform ?? 'browser',
    format: 'esm',
    target: target,
    logLimit: 0,
    plugins: [compilerPlugin, commonjsPlugin(), ...customPlugins, ...(extra.extraPlugins ?? [])],
    define: {
      ...(dev ? {} : { ngDevMode: 'false' }),
      ngJitMode: 'false',
    },
    ...(builderOptions.loader ? { loader: builderOptions.loader } : {}),
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs'],
  };

  const ctx = await esbuild.context(config);

  return { ctx, pluginDisposed };
}

async function getTailwindConfig(
  searchDirectories: { root: string; files: Set<string> }[]
): Promise<{ file: string; package: string } | undefined> {
  const tailwindConfigurationPath = findTailwindConfiguration(searchDirectories);

  if (!tailwindConfigurationPath) {
    return undefined;
  }

  return {
    file: tailwindConfigurationPath,
    package: createRequire(tailwindConfigurationPath).resolve('tailwindcss'),
  };
}

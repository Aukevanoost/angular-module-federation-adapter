import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';
import type { SourceFileCache } from '@angular/build/private';
import type { FederationCache } from '@softarc/native-federation';

import { normalizeContextOptions } from '../../utils/normalize-context-options.js';
import { createFederationEsbuildContext } from './federation-side-build.js';
import {
  toExposedEntryPoints,
  type FederationEntryPoint,
} from './federation-entry-points.js';
import type {
  FederationConfigInput,
  FederationSharedInput,
} from './to-plugin-config.js';
import type { NfInternalOptions } from '../../builders/build/schema.js';

/**
 * Minimal normalized-config shape this driver reads. NF's
 * `NormalizedFederationConfig` satisfies it structurally (transitional — Phase 3
 * replaces the config loader with `withModuleFederation`).
 */
export interface NormalizedConfig {
  name: string;
  filename?: string;
  exposes?: Record<string, { file: string }>;
  shared?: Record<string, FederationSharedInput>;
  sharedMappings?: Record<string, string>;
  remotes?: Record<string, string>;
  chunks?: boolean;
  /** NF puts `features` on the config; `optimizedMappings` reads `ignoreUnusedDeps`. */
  features?: { ignoreUnusedDeps?: boolean };
}

/** Federation options the builder already computed (subset NF's `fedOptions` provides). */
export interface FederationOptions {
  outputPath: string;
  /** Optional to match NF's `fedOptions.tsConfig`; `createAngularEsbuildContext` guards undefined at runtime. */
  tsConfig?: string;
  dev?: boolean;
  watch?: boolean;
  federationCache: FederationCache<SourceFileCache>;
}

/** MF-shaped build result (replaces NF's `FederationInfo`); consumed by i18n (M4.2). */
export interface MfFederationInfo {
  name: string;
  exposes: string[];
  writtenFiles: string[];
}

/** Shared-mappings → entry points (mirrors NF's `bundleExposedAndMappings`). */
function toMappingEntryPoints(
  sharedMappings: Record<string, string> = {}
): FederationEntryPoint[] {
  return Object.entries(sharedMappings).map(([entryPoint, mappedImport]) => ({
    fileName: entryPoint,
    outName: mappedImport.replace(/[^A-Za-z0-9]/g, '_') + '.js',
    key: mappedImport,
  }));
}

/** NF normalized config → the MF plugin's `FederationConfigInput` (exposes value → file path). */
function toFederationConfigInput(config: NormalizedConfig): FederationConfigInput {
  const exposes: Record<string, string> = {};
  for (const [key, expose] of Object.entries(config.exposes ?? {})) {
    exposes[key] = expose.file;
  }
  return {
    name: config.name,
    filename: config.filename,
    exposes,
    shared: config.shared,
    remotes: config.remotes,
  };
}

/** Build context for the MF side build. */
export interface BuilderCtx {
  builderOptions: ApplicationBuilderOptions & NfInternalOptions;
  context: BuilderContext;
}

/**
 * Stateful MF side builder (M2.1) — the `buildForFederation` + `rebuildForFederation`
 * replacement. Holds one esbuild `BuildContext` (Angular compiler +
 * `moduleFederationPlugin`, one-pass) across rebuilds so `ng serve` incremental
 * DX (M2.6) is preserved — mirroring NF's adapter lifecycle (setup → build →
 * rebuild* → dispose). NF's four shared-bundling phases are gone (MF owns shared,
 * finding #6); the plugin emits `remoteEntry.js` + `mf-manifest.json`.
 *
 * Field values mirror NF's `bundleExposedAndMappings` exactly, so it is
 * correct-by-construction against the existing context machinery.
 *
 * ⚠️ Type-checked, not yet runtime-verified: emitting against a real Angular app
 * needs a browser/Angular env absent here (same limit as the M1.7 e2e).
 */
export interface MfFederationBuilder {
  /** Initial build: bundle exposed modules + emit container/manifest. */
  build(): Promise<MfFederationInfo>;
  /** Incremental rebuild for `ng serve` (invalidates the changed files first). */
  rebuild(modifiedFiles?: string[]): Promise<MfFederationInfo>;
  /** Tear down the esbuild context (call once when the build/watch ends). */
  dispose(): Promise<void>;
}

export async function createMfFederationBuilder(
  config: NormalizedConfig,
  fedOptions: FederationOptions,
  externals: string[],
  ctx: BuilderCtx
): Promise<MfFederationBuilder> {
  const entryPoints: FederationEntryPoint[] = [
    ...toMappingEntryPoints(config.sharedMappings),
    ...toExposedEntryPoints(config.exposes),
  ];

  const options = normalizeContextOptions(ctx.builderOptions, ctx.context, {
    entryPoints,
    outdir: fedOptions.outputPath,
    tsConfigPath: fedOptions.tsConfig,
    external: externals,
    dev: !!fedOptions.dev,
    watch: fedOptions.watch,
    mappedPaths: config.sharedMappings ?? {},
    chunks: config.chunks,
    hash: !fedOptions.dev,
    optimizedMappings: !!config.features?.ignoreUnusedDeps,
    isMappingOrExposed: true,
    cache: fedOptions.federationCache,
  });

  const { ctx: buildContext, pluginDisposed } = await createFederationEsbuildContext(
    options,
    toFederationConfigInput(config)
  );

  const runWrite = async (): Promise<MfFederationInfo> => {
    const result = await buildContext.rebuild();
    // write:true → esbuild emitted the chunks + container, and the MF plugin's
    // onEnd rewrote the container (module map) + wrote mf-manifest.json. Collect
    // the emitted files from the metafile (the plugin forces metafile:true).
    const writtenFiles = result.metafile ? Object.keys(result.metafile.outputs) : [];
    return {
      name: config.name,
      exposes: Object.keys(config.exposes ?? {}),
      writtenFiles,
    };
  };

  let disposed = false;
  return {
    build: runWrite,
    async rebuild(modifiedFiles = []) {
      options.cache.bundlerCache.invalidate(new Set(modifiedFiles));
      return runWrite();
    },
    // Idempotent: the build builder disposes once for the #47 TS-state reset
    // (non-watch) and again in its final cleanup, so guard against double-dispose.
    async dispose() {
      if (disposed) return;
      disposed = true;
      await buildContext.dispose();
      await pluginDisposed;
    },
  };
}

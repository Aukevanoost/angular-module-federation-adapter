import '../build/setup-builder-env-variables.js';

import * as fs from 'fs';
import * as path from 'path';
import * as mrmime from 'mrmime';

import { type ApplicationBuilderOptions } from '@angular/build';
import { SourceFileCache } from '@angular/build/private';

import { type BuilderContext, type BuilderOutput, createBuilder } from '@angular-devkit/architect';

import {
  buildForFederation,
  rebuildForFederation,
  getExternals,
  normalizeFederationOptions,
  setBuildAdapter,
  createFederationCache,
} from '@softarc/native-federation';
import {
  logger,
  setLogLevel,
  RebuildQueue,
  AbortedError,
  getDefaultCachePath,
  type NfFileWatcher,
  syncNfFileWatcher,
  createNfWatcher,
} from '@softarc/native-federation/internal';
import { createAngularBuildAdapter } from '../../utils/angular-esbuild-adapter.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { federationBuildNotifier } from '../build/federation-build-notifier.js';
import type { NfSlimBuilderSchema, NfSlimIndexOption, NfSlimInternalOptions } from './schema.js';
import { checkForInvalidImports } from '../../utils/check-for-invalid-imports.js';
import { createServer as createViteServer, type InlineConfig, type ViteDevServer } from 'vite';

export async function* runSlimBuilder(
  nfBuilderOptions: NfSlimBuilderSchema & NfSlimInternalOptions,
  context: BuilderContext
): AsyncIterable<BuilderOutput> {
  const federationTsConfig = nfBuilderOptions.tsConfig;
  const outputBase = nfBuilderOptions.outputPath ?? `dist/${context.target!.project}`;

  const ngBuilderOptions: ApplicationBuilderOptions = {
    tsConfig: federationTsConfig,
    outputPath: outputBase,
  } as ApplicationBuilderOptions;

  const adapter = createAngularBuildAdapter(ngBuilderOptions, context);

  setBuildAdapter(adapter);

  setLogLevel(nfBuilderOptions.verbose ? 'verbose' : 'info');

  const browserOutputPath = path.join(outputBase, 'browser');
  const devServerOutputPath = browserOutputPath;

  const entryPoints: string[] | undefined =
    nfBuilderOptions.entryPoints && nfBuilderOptions.entryPoints.length > 0
      ? nfBuilderOptions.entryPoints
      : [path.join(path.dirname(federationTsConfig), 'src/main.ts')];

  const cachePath = getDefaultCachePath(context.workspaceRoot);

  const normalized = await normalizeFederationOptions(
    {
      projectName: nfBuilderOptions.projectName,
      workspaceRoot: context.workspaceRoot,
      outputPath: browserOutputPath,
      federationConfig: inferConfigPath(federationTsConfig, context.workspaceRoot),
      tsConfig: federationTsConfig,
      verbose: nfBuilderOptions.verbose,
      watch: nfBuilderOptions.watch,
      dev: !!nfBuilderOptions.dev,
      entryPoints,
      buildNotifications: nfBuilderOptions.buildNotifications,
      cacheExternalArtifacts: nfBuilderOptions.cacheExternalArtifacts !== false,
    },
    createFederationCache(cachePath, new SourceFileCache(cachePath))
  );

  checkForInvalidImports(Object.values(normalized.config.sharedMappings), 'shared mappings');
  checkForInvalidImports(Object.keys(normalized.config.shared), 'externals');

  const start = process.hrtime();
  logger.measure(start, 'To load the federation config.');

  const externals = getExternals(normalized.config);

  const isLocalDevelopment = nfBuilderOptions.watch && nfBuilderOptions.dev;

  if (isLocalDevelopment && nfBuilderOptions.buildNotifications?.enable) {
    federationBuildNotifier.initialize(nfBuilderOptions.buildNotifications.endpoint);
  }

  const middleware = [
    ...(isLocalDevelopment
      ? [federationBuildNotifier.createEventMiddleware(req => req.url ?? '')]
      : []),

    (
      req: { url?: string },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      },
      next: () => void
    ) => {
      const url = req.url ?? '';
      const isRoot = url === '/' || url === '';
      const relPath = isRoot ? 'index.html' : url;
      const fileName = path.join(normalized.options.workspaceRoot, devServerOutputPath, relPath);

      if (fs.existsSync(fileName) && fs.statSync(fileName).isFile()) {
        const lookup = mrmime.lookup;
        const mimeType = lookup(path.extname(fileName)) || 'text/javascript';
        const rawBody = fs.readFileSync(fileName, 'utf-8');

        res.writeHead(200, {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end(rawBody);
      } else {
        next();
      }
    },
  ];

  const pendingPaths = new Set<string>();
  let notifyChange: () => void = () => {};
  let changePromise: Promise<void> = new Promise<void>(r => (notifyChange = r));
  const resetChangePromise = () => {
    changePromise = new Promise<void>(r => (notifyChange = r));
  };

  // Debounce at the source: fs.watch fires multiple events per save (write+rename,
  // directory + per-file watchers overlapping). Only wake the rebuild loop after
  // `rebuildDelay` ms of quiescence so a burst collapses into one cycle.
  const debounceMs = Math.max(10, nfBuilderOptions.rebuildDelay);
  let debounceTimer: NodeJS.Timeout | undefined;
  const scheduleNotify = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      notifyChange();
    }, debounceMs);
  };

  const nfWatcher: NfFileWatcher | undefined = nfBuilderOptions.watch
    ? createNfWatcher({
        onChange: p => {
          pendingPaths.add(p);
          scheduleNotify();
        },
      })
    : undefined;

  if (nfWatcher) {
    nfWatcher.addPaths(path.dirname(path.resolve(context.workspaceRoot, federationTsConfig)));
  }

  if (existsSync(normalized.options.outputPath)) {
    rmSync(normalized.options.outputPath, { recursive: true });
  }

  if (!existsSync(normalized.options.outputPath)) {
    mkdirSync(normalized.options.outputPath, { recursive: true });
  }

  try {
    await buildForFederation(normalized.config, normalized.options, externals);
  } catch (e) {
    logger.error((e as Error)?.message ?? 'Building the artifacts failed');
    process.exit(1);
  }

  if (nfWatcher) {
    syncNfFileWatcher(nfWatcher, normalized.options.federationCache.bundlerCache);
  }

  writeSlimIndexHtml(
    path.resolve(context.workspaceRoot, devServerOutputPath),
    context.workspaceRoot,
    nfBuilderOptions.index
  );

  const rebuildQueue = new RebuildQueue();

  let viteServer: ViteDevServer | undefined;
  if (nfBuilderOptions.watch) {
    const viteConfig: InlineConfig = {
      configFile: false,
      envFile: false,
      appType: 'custom',
      root: path.resolve(context.workspaceRoot, devServerOutputPath),
      publicDir: false,
      mode: 'development',
      server: {
        port: nfBuilderOptions.port || undefined,
        strictPort: !!nfBuilderOptions.port,
        cors: { origin: true, preflightContinue: true },
        middlewareMode: false,
        preTransformRequests: false,
        watch: null,
      },
      plugins: [
        {
          name: 'nf-slim-middleware',
          configureServer(server) {
            for (const mw of middleware) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              server.middlewares.use(mw as any);
            }
          },
        },
      ],
    };

    viteServer = await createViteServer(viteConfig);
    await viteServer.listen();
    viteServer.printUrls?.();
  }

  try {
    yield { success: true };

    while (nfBuilderOptions.watch) {
      await changePromise;
      resetChangePromise();

      // fs.watch fires multiple events per save (write+rename, plus overlapping
      // directory and per-file watchers). Redundant events arriving during a
      // rebuild resolve the next promise, so without this guard the loop runs a
      // second phantom build with an empty snapshot once the first one finishes.
      if (pendingPaths.size === 0) continue;

      const trackResult = await rebuildQueue.track(async (signal: AbortSignal) => {
        try {
          if (signal?.aborted) {
            throw new AbortedError('Build canceled before starting');
          }

          // Snapshot but don't clear — if the build is aborted or fails,
          // the paths stay in pendingPaths and are retried on the next cycle.
          const changedFiles = [...pendingPaths];

          await rebuildForFederation(
            normalized.config,
            normalized.options,
            externals,
            changedFiles,
            signal
          );

          // Clear only what we consumed. Any paths pushed during the build
          // remain in pendingPaths and will drive the next iteration.
          for (const p of changedFiles) pendingPaths.delete(p);

          if (nfWatcher) {
            syncNfFileWatcher(nfWatcher, normalized.options.federationCache.bundlerCache);
          }

          if (signal?.aborted) {
            throw new AbortedError('[slim-builder] After federation build.');
          }

          logger.info('Done!');

          if (isLocalDevelopment) {
            federationBuildNotifier.broadcastBuildCompletion();
          }
          return { success: true };
        } catch (error) {
          if (error instanceof AbortedError) {
            logger.verbose('Rebuild was canceled. Cancellation point: ' + error?.message);
            federationBuildNotifier.broadcastBuildCancellation();
            return { success: false, cancelled: true };
          }
          logger.error('Federation rebuild failed!');
          if (nfBuilderOptions.verbose) console.error(error);
          if (isLocalDevelopment) {
            federationBuildNotifier.broadcastBuildError(error);
          }
          return { success: false };
        }
      });

      if (trackResult.type === 'completed' && !trackResult.result.cancelled) {
        yield { success: trackResult.result.success };
      }
    }
  } finally {
    if (debounceTimer) clearTimeout(debounceTimer);
    rebuildQueue.dispose();
    await adapter.dispose();
    await nfWatcher?.close();
    await viteServer?.close();

    if (isLocalDevelopment) {
      federationBuildNotifier.stopEventServer();
    }
  }
}

function writeSlimIndexHtml(
  outputDir: string,
  workspaceRoot: string,
  index: NfSlimIndexOption | undefined
): void {
  if (index === false) return;

  if (index !== undefined) {
    const input = typeof index === 'string' ? index : index.input;
    const outputName = typeof index === 'object' && index.output ? index.output : 'index.html';

    const resolvedInput = path.resolve(workspaceRoot, input);
    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`[slim-builder] Configured index file not found: ${resolvedInput}`);
    }

    const destination = path.join(outputDir, outputName);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(resolvedInput, destination);
    return;
  }

  const indexPath = path.join(outputDir, 'index.html');
  if (fs.existsSync(indexPath)) return;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Native Federation Remote</title>
</head>
<body>
  <p>This is a Native Federation remote. Load it through a host application.</p>
</body>
</html>
`;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(indexPath, html, 'utf-8');
}

function inferConfigPath(tsConfig: string, workspaceRoot: string): string {
  const relProjectPath = path.dirname(tsConfig);
  const mjsRelPath = path.join(relProjectPath, 'federation.config.mjs');

  if (fs.existsSync(path.resolve(workspaceRoot, mjsRelPath))) {
    return mjsRelPath;
  }

  return path.join(relProjectPath, 'federation.config.js');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createBuilder(runSlimBuilder) as any;

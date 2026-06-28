import '../build/setup-builder-env-variables.js';

import * as path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

import { SourceFileCache } from '@angular/build/private';

import { type BuilderContext, type BuilderOutput, createBuilder } from '@angular-devkit/architect';

import { createFederationCache } from '@softarc/native-federation';
import {
  logger,
  setLogLevel,
  RebuildQueue,
  AbortedError,
  getDefaultCachePath,
  syncNfFileWatcher,
} from '@softarc/native-federation/internal';

import { createMfFederationBuilder } from '../../tools/mf/build-for-federation.js';
import { loadFederationConfig } from '../../tools/mf/load-federation-config.js';
import { getHostExternals } from '../build/get-externals.js';
import { checkForInvalidImports } from '../../utils/check-for-invalid-imports.js';

import type { NfRemoteBuilderSchema, NfRemoteInternalOptions } from './schema.js';
import { resolveNgBuilderOptions } from './resolve-ng-options.js';
import { inferFederationConfigPath } from './infer-config-path.js';
import { createDebouncedChangeWatcher } from './change-watcher.js';
import {
  copyAllAssets,
  copyChangedAssets,
  getAssetWatchDirs,
  normalizeRemoteAssetEntries,
} from './assets.js';

/**
 * THIS BUILDER IS EXPERIMENTAL AND MIGHT CHANGE OVER TIME
 *
 * @param nfBuilderOptions
 * @param context
 */

export async function* runRemoteBuilder(
  nfBuilderOptions: NfRemoteBuilderSchema & NfRemoteInternalOptions,
  context: BuilderContext
): AsyncIterable<BuilderOutput> {
  const federationTsConfig = nfBuilderOptions.tsConfig;
  const outputBase = nfBuilderOptions.outputPath ?? `dist/${context.target!.project}`;
  const browserOutputPath = path.join(outputBase, 'browser');
  const absoluteBrowserOutput = path.resolve(context.workspaceRoot, browserOutputPath);

  const { ngBuilderOptions, projectRoot, projectSourceRoot } = await resolveNgBuilderOptions(
    nfBuilderOptions,
    context
  );

  setLogLevel(nfBuilderOptions.verbose ? 'verbose' : 'info');

  const cachePath = getDefaultCachePath(context.workspaceRoot);
  const federationCache = createFederationCache(
    cachePath,
    new SourceFileCache(cachePath)
  );

  const config = await loadFederationConfig(
    context.workspaceRoot,
    inferFederationConfigPath(federationTsConfig, context.workspaceRoot)
  );

  // Share scope / manifest id prefix; fall back to the project name so it's never empty.
  if (!config.name) {
    config.name = context.target!.project;
  }

  checkForInvalidImports(Object.keys(config.shared ?? {}), 'externals');

  const fedOptions = {
    outputPath: browserOutputPath,
    tsConfig: federationTsConfig,
    dev: !!nfBuilderOptions.dev,
    watch: nfBuilderOptions.watch,
    federationCache,
  };

  const start = process.hrtime();
  logger.measure(start, 'To load the federation config.');

  const externals = getHostExternals(config.shared);

  const mfBuilder = await createMfFederationBuilder(config, fedOptions, externals, {
    builderOptions: ngBuilderOptions,
    context,
  });

  const assetEntries = normalizeRemoteAssetEntries(
    nfBuilderOptions.assets,
    context.workspaceRoot,
    projectRoot,
    projectSourceRoot
  );

  const changeWatcher = nfBuilderOptions.watch
    ? createDebouncedChangeWatcher(nfBuilderOptions.rebuildDelay)
    : undefined;

  if (changeWatcher) {
    changeWatcher.watcher.addPaths(
      path.dirname(path.resolve(context.workspaceRoot, federationTsConfig))
    );
    for (const assetDir of getAssetWatchDirs(assetEntries, context.workspaceRoot)) {
      changeWatcher.watcher.addPaths(assetDir);
    }
  }

  if (existsSync(browserOutputPath)) {
    rmSync(browserOutputPath, { recursive: true });
  }
  mkdirSync(browserOutputPath, { recursive: true });

  try {
    await mfBuilder.build();
  } catch (e) {
    logger.error((e as Error)?.message ?? 'Building the artifacts failed');
    process.exit(1);
  }

  await copyAllAssets(assetEntries, absoluteBrowserOutput, context.workspaceRoot);

  if (changeWatcher) {
    syncNfFileWatcher(changeWatcher.watcher, federationCache.bundlerCache);
  }

  const rebuildQueue = new RebuildQueue();

  try {
    yield { success: true };

    while (nfBuilderOptions.watch && changeWatcher) {
      await changeWatcher.waitForChange();
      changeWatcher.resetChangePromise();

      // fs.watch fires multiple events per save (write+rename, plus overlapping
      // directory and per-file watchers). Redundant events arriving during a
      // rebuild resolve the next promise, so without this guard the loop runs a
      // second phantom build with an empty snapshot once the first one finishes.
      if (changeWatcher.pendingPaths.size === 0) continue;

      // The freshly-reset change promise doubles as the interrupt signal: if a
      // newer (debounced) change lands while this rebuild is in flight, abort it
      // and loop to fold the new paths in — mirroring how the `build` builder
      // passes Angular's next output as the interrupt to RebuildQueue.track.
      // Without this, RebuildQueue's AbortSignal is never triggered and a stale
      // rebuild must finish before a fresh save is picked up.
      const interruptPromise = changeWatcher.waitForChange();

      const trackResult = await rebuildQueue.track(async (signal: AbortSignal) => {
        try {
          if (signal?.aborted) {
            throw new AbortedError('Build canceled before starting');
          }

          // Snapshot but don't clear — unlike the build builder (which clears its
          // buffer eagerly and relies on Angular's iterator to re-trigger), this
          // builder owns its watcher, so if the build is aborted or fails the paths
          // stay in pendingPaths and are retried on the next cycle.
          const changedFiles = [...changeWatcher.pendingPaths];

          // NF's rebuild took an AbortSignal for mid-build cancellation; the MF
          // builder reuses its esbuild context (fast incremental rebuild), and the
          // RebuildQueue still wraps it with `signal` for queue-level interruption.
          await mfBuilder.rebuild(changedFiles);

          await copyChangedAssets(
            assetEntries,
            absoluteBrowserOutput,
            context.workspaceRoot,
            changedFiles
          );

          // Clear only what we consumed. Any paths pushed during the build
          // remain in pendingPaths and will drive the next iteration.
          for (const p of changedFiles) changeWatcher.pendingPaths.delete(p);

          syncNfFileWatcher(changeWatcher.watcher, federationCache.bundlerCache);

          if (signal?.aborted) {
            throw new AbortedError('[remote-builder] After federation build.');
          }

          logger.info('Done!');

          return { success: true };
        } catch (error) {
          if (error instanceof AbortedError) {
            logger.verbose('Rebuild was canceled. Cancellation point: ' + error?.message);
            return { success: false, cancelled: true };
          }
          logger.error('Federation rebuild failed!');
          if (nfBuilderOptions.verbose) console.error(error);
          return { success: false };
        }
      }, interruptPromise);

      // Mirrors the build builder's trackResult handling, minus the iterator pump:
      // there the 'interrupted' branch feeds Angular's next output back into the
      // loop, whereas here the new change has already resolved the current change
      // promise, so the next loop iteration picks it up immediately. The aborted
      // build left its paths in pendingPaths, so nothing is lost.
      if (trackResult.type === 'completed' && !trackResult.result.cancelled) {
        yield { success: trackResult.result.success };
      }
    }
  } finally {
    changeWatcher?.dispose();
    rebuildQueue.dispose();
    await mfBuilder.dispose();
    await changeWatcher?.watcher.close();

    // Force-exit the leaked esbuild service on a non-watch build (see build
    // builder). ref: https://github.com/angular/angular-cli/issues/33201
    if (!nfBuilderOptions.watch) {
      setTimeout(() => process.exit(0), 100).unref();
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createBuilder(runRemoteBuilder) as any;

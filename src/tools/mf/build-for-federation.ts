import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';
import type { SourceFileCache } from '@angular/build/private';
import type { FederationCache } from '@softarc/native-federation';

import { normalizeContextOptions } from '../../utils/normalize-context-options.js';
import { createFederationEsbuildContext } from './federation-side-build.js';
import { toExposedEntryPoints } from './federation-entry-points.js';
import type {
  FederationConfigInput,
  FederationSharedInput,
} from './to-plugin-config.js';
import type { NfInternalOptions } from '../../builders/build/schema.js';

/**
 * The MF config shape emitted by `withModuleFederation`; `exposes` values are
 * source-path strings. `NormalizedModuleFederationConfig` satisfies it structurally.
 */
export interface NormalizedConfig {
  name: string;
  filename?: string;
  exposes?: Record<string, string>;
  shared?: Record<string, FederationSharedInput>;
  remotes?: Record<string, string>;
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

/** MF config → the MF plugin's `FederationConfigInput` (exposes values are already source paths). */
function toFederationConfigInput(config: NormalizedConfig): FederationConfigInput {
  return {
    name: config.name,
    filename: config.filename,
    exposes: config.exposes,
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
  const entryPoints = toExposedEntryPoints(config.exposes);

  const options = normalizeContextOptions(ctx.builderOptions, ctx.context, {
    entryPoints,
    outdir: fedOptions.outputPath,
    tsConfigPath: fedOptions.tsConfig,
    external: externals,
    dev: !!fedOptions.dev,
    watch: fedOptions.watch,
    mappedPaths: {},
    hash: !fedOptions.dev,
    optimizedMappings: false,
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

import type { NormalizedContextOptions } from '../../utils/normalize-context-options.js';
import { createAngularEsbuildContext } from '../esbuild/angular-bundler.js';
import { createFederationPlugin } from './federation-plugin.js';
import type { FederationConfigInput } from './to-plugin-config.js';

/**
 * MF side-build context (M2.1 driver). Replaces NF's `buildForFederation` build
 * path: reuses the Angular compiler esbuild context and injects
 * `moduleFederationPlugin` as an extra plugin — the one-pass composition proven
 * feasible from the plugin source (the compiler plugin compiles exposed `.ts`;
 * the MF plugin wraps the container; the nested shared sub-build is
 * commonjs-only, so the compiler never runs twice).
 *
 * Returns the esbuild `BuildContext` + the compiler's `pluginDisposed`, mirroring
 * `createAngularEsbuildContext` so the existing orchestration loop (rebuild
 * queue, dispose) drives it unchanged.
 *
 * ⚠️ End-to-end artifact emission is only verifiable against a real Angular app
 * (absent in this sandbox — same limit as the M1.7 e2e); this is code-complete
 * and type-checked, emit-proof deferred.
 */
export function createFederationEsbuildContext(
  options: NormalizedContextOptions,
  federationConfig: FederationConfigInput
): ReturnType<typeof createAngularEsbuildContext> {
  // `write: true` (M2.2): the MF plugin's `onEnd` reads the emitted container off
  // disk to inject the module map, so it cannot run under the NF `write:false` +
  // writeResult flow. esbuild writes the chunks/container/manifest to `outdir`.
  return createAngularEsbuildContext(options, {
    extraPlugins: [createFederationPlugin(federationConfig)],
    write: true,
  });
}

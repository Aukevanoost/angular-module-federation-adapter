import { moduleFederationPlugin } from '@module-federation/esbuild/plugin';
import type { Plugin } from 'esbuild';
import { toMfPluginConfig, type FederationConfigInput } from './to-plugin-config.js';

/**
 * The esbuild plugin injected into the Angular esbuild context (M2.1 keystone:
 * one-pass composition). It wraps the exposed Angular modules — already compiled
 * by the co-present Angular compiler plugin — into the MF container and emits
 * `remoteEntry.js` + `mf-manifest.json`. Externals/shared resolution flows
 * through es-module-shims import maps (finding #6).
 */
export function createFederationPlugin(
  cfg: FederationConfigInput,
  filename?: string
): Plugin {
  return moduleFederationPlugin(toMfPluginConfig(cfg, filename));
}

import type { moduleFederationPlugin } from '@module-federation/esbuild/plugin';

/**
 * Config object accepted by `@module-federation/esbuild`'s `moduleFederationPlugin`
 * (its `NormalizedFederationConfig`). Derived via `Parameters<>` so we don't reach
 * into the plugin's `dist/lib/config/*` internals.
 */
export type MfPluginConfig = Parameters<typeof moduleFederationPlugin>[0];
type MfShared = NonNullable<MfPluginConfig['shared']>;

/**
 * Minimal shape we read off a *normalized* federation config to drive the MF
 * side build. Declared locally (not imported from `@softarc/native-federation`)
 * so this mapper survives the Phase-3 NF removal — both NF's and MF's own
 * normalized configs satisfy it.
 */
export interface FederationConfigInput {
  name: string;
  filename?: string;
  exposes?: Record<string, string>;
  shared?: Record<string, FederationSharedInput>;
  remotes?: Record<string, string>;
}

export interface FederationSharedInput {
  singleton?: boolean;
  strictVersion?: boolean;
  /** Concrete range by the normalized stage (NF resolves `'auto'` upstream). */
  requiredVersion?: string;
  version?: string;
  eager?: boolean;
  includeSecondaries?: boolean;
}

function mapShared(shared: FederationConfigInput['shared']): MfShared {
  const out: MfShared = {};
  for (const [pkg, cfg] of Object.entries(shared ?? {})) {
    out[pkg] = {
      singleton: cfg.singleton ?? false,
      strictVersion: cfg.strictVersion ?? false,
      // The plugin's NormalizedSharedConfig requires a string here (no `false`,
      // unlike the runtime). Fall back to `'*'` when unresolved.
      requiredVersion: cfg.requiredVersion ?? '*',
      version: cfg.version,
      eager: cfg.eager,
      // ✅ Spike-confirmed (finding #4): the esbuild plugin DOES support
      // `includeSecondaries` — so it maps 1:1, contra M3.1's table.
      includeSecondaries: cfg.includeSecondaries,
    };
  }
  return out;
}

/**
 * Map a normalized federation config → `moduleFederationPlugin` options (the
 * config half of M2.1). Pairs with the proven esbuild invocation (M0.1 / the
 * in-workspace re-proof) to form the side build. The plugin emits
 * `remoteEntry.js` + `mf-manifest.json`.
 */
export function toMfPluginConfig(
  cfg: FederationConfigInput,
  filename = 'remoteEntry.js'
): MfPluginConfig {
  return {
    name: cfg.name,
    filename: cfg.filename ?? filename,
    exposes: cfg.exposes ?? {},
    shared: mapShared(cfg.shared),
    remotes: cfg.remotes,
  };
}

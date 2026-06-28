// M3.1 — `withModuleFederation` mirroring NF's `withNativeFederation`, built as a
// thin Angular wrapper over `@module-federation/esbuild`'s OWN config layer
// (finding #4). Imported from the deep `dist/lib/config/*` path because the
// high-level `./build` entry throws on import (Breakage A, the `json5` defect);
// the deep path is allowed by the package's `"./*"` export and is Breakage-A-free.
// ⚠️ Deep-import fragility: pinned to @module-federation/esbuild@0.0.109 internals;
// re-verify these paths on any version bump (tracked with the dominant 0.0.x risk).
import {
  share as coreShare,
  shareAll as coreShareAll,
} from '@module-federation/esbuild/dist/lib/config/share-utils.js';
import { withFederation as coreWithFederation } from '@module-federation/esbuild/dist/lib/config/with-native-federation.js';
import { NG_SKIP_LIST } from './angular-skip-list.js';

/**
 * Package-name prefixes that imply a server (Node) build. Matched with
 * `startsWith`, so secondary entry points (e.g. `@angular/ssr/node`) match too.
 * (Carried over from NF's `share-utils.ts` unchanged.)
 */
export const SERVER_DEPENDENCIES = ['@angular/platform-server', '@angular/ssr'];

/**
 * Infers the default federation platform from the shared dependency keys:
 * `'node'` if any is an Angular server package, else `'browser'`.
 *
 * ⚠️ MF has **no `platform` shared-key** (M3.1 table) — this stays an Angular-side
 * build hint (drives the SSR side build + shared-set selection, Phase 4), not an
 * MF `shared` field.
 */
export function getDefaultPlatform(deps: string[]): 'browser' | 'node' {
  return deps.some((dep) => SERVER_DEPENDENCIES.some((s) => dep.startsWith(s)))
    ? 'node'
    : 'browser';
}

/** MF shared-config entry (mirrors `@module-federation/esbuild`'s `SharedConfig`). */
export interface MfSharedConfig {
  requiredVersion?: string;
  singleton?: boolean;
  strictVersion?: boolean;
  version?: string;
  eager?: boolean;
  includeSecondaries?: boolean | { skip?: string | string[] };
}

/**
 * Share specific packages as MF singletons. Thin pass-through to MF-esbuild's
 * `share` (which resolves `requiredVersion: 'auto'`-style versions via
 * `lookupVersion` at config-build time — the M3.1 table's `'auto'` mapping).
 */
export function share(
  shareObjects: Record<string, MfSharedConfig>,
  projectPath?: string
): Record<string, MfSharedConfig> {
  return coreShare(shareObjects, projectPath) as Record<string, MfSharedConfig>;
}

/**
 * Share all dependencies from `package.json` as MF singletons. Delegates to
 * MF-esbuild's `shareAll`; `skip` defaults to the Angular skip-list
 * ({@link NG_SKIP_LIST}, M3.2) so Angular framework/testing/locale packages and
 * this adapter itself are not auto-shared.
 */
export function shareAll(
  config: MfSharedConfig,
  skip: typeof NG_SKIP_LIST = NG_SKIP_LIST,
  projectPath?: string
): Record<string, MfSharedConfig> {
  return coreShareAll(
    config as Parameters<typeof coreShareAll>[0],
    skip as Parameters<typeof coreShareAll>[1],
    projectPath
  ) as Record<string, MfSharedConfig>;
}

/** Normalized output of {@link withModuleFederation} (consumed by the side build). */
export interface NormalizedModuleFederationConfig {
  name: string;
  filename: string;
  exposes: Record<string, string>;
  remotes: Record<string, string>;
  shared: Record<string, MfSharedConfig>;
  /** Angular-side build hint, not an MF shared key. */
  platform: 'browser' | 'node';
}

/** Angular federation config input (mirrors NF's `FederationConfig` surface). */
export interface ModuleFederationConfig {
  name?: string;
  filename?: string;
  exposes?: Record<string, string>;
  remotes?: Record<string, string>;
  shared?: Record<string, MfSharedConfig>;
  skip?: string[];
  /** Angular-side build hint (browser|node); auto-filled from shared deps if omitted. */
  platform?: 'browser' | 'node';
}

/**
 * Angular `withModuleFederation` (M3.1). Auto-fills the Angular-side `platform`
 * hint (NF parity), then normalizes via MF-esbuild's own `withFederation`.
 *
 * NF→MF field decisions (M3.1 table): `singleton`/`strictVersion`/`requiredVersion`/
 * `version`/`eager`/`includeSecondaries` all map 1:1 (the MF plugin supports
 * `includeSecondaries` — finding #4). NF-only `build`/`features.{denseChunking,
 * ignoreUnusedDeps}` are **dropped** (no MF equivalent; MF shares only what's listed).
 */
export function withModuleFederation(
  cfg: ModuleFederationConfig
): NormalizedModuleFederationConfig {
  const platform = cfg.platform ?? getDefaultPlatform(Object.keys(cfg.shared ?? {}));
  const { name, filename, exposes, remotes, shared, skip } = cfg;
  // Cast: upstream `withFederation` types `includeSecondaries` as `boolean` only,
  // while its own `share-utils` accepts the `{ skip }` object form too — the
  // runtime handles both. (Type defs disagree across the two upstream modules.)
  const normalized = coreWithFederation({
    name,
    filename,
    exposes,
    remotes,
    shared,
    skip,
  } as Parameters<typeof coreWithFederation>[0]);
  // `platform` is re-attached as an Angular-side hint (not an MF shared key).
  return { ...normalized, platform } as NormalizedModuleFederationConfig;
}

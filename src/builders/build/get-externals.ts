import { DEFAULT_ANGULAR_SHARED, type SharedConfig } from '../../index.js';

/**
 * MF equivalent of NF's `getExternals` (host path, M1.5): the packages the
 * Angular app build must mark `external` so they resolve from the shared scope
 * (es-module-shims import map, finding #6) instead of being bundled. For a pure
 * host this is exactly the shared singleton set.
 *
 * Mirrors NF's trivial `[...Object.keys(shared), ...sharedMappings, ...externals]`,
 * MF-shaped: the keys of the MF `shared` map (+ any extra explicit externals).
 *
 * ⚠️ The builder call-site swap (replacing `getExternals(normalized.config)` at
 * `builder.ts:297`) is performed in **M2.1**, not here: that line and
 * `buildForFederation` (`builder.ts:425`) consume the *same* `normalized.config`,
 * so the externals source and the side-build's `shared` must switch to MF
 * together — otherwise the host externalizes deps nothing provides.
 */
export function getHostExternals(
  shared: SharedConfig = DEFAULT_ANGULAR_SHARED,
  extraExternals: string[] = []
): string[] {
  return [...new Set([...Object.keys(shared), ...extraExternals])];
}

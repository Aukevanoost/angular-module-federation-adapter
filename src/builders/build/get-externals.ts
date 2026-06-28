import { DEFAULT_ANGULAR_SHARED } from '../../index.js';

/**
 * Packages the Angular app build must mark `external` so they resolve from the
 * shared scope instead of being bundled — the keys of the MF `shared` map plus
 * any extra explicit externals. Replaces NF's `getExternals`.
 */
export function getHostExternals(
  shared: Record<string, unknown> = DEFAULT_ANGULAR_SHARED,
  extraExternals: string[] = []
): string[] {
  return [...new Set([...Object.keys(shared), ...extraExternals])];
}

/**
 * esbuild entry-point descriptor for the side build. Structurally matches NF's
 * `EntryPoint` (`{ fileName, outName, key? }`) so it's assignable to
 * `createAngularEsbuildContext`'s param, but declared locally to survive the
 * Phase-3 NF removal.
 */
export interface FederationEntryPoint {
  fileName: string;
  outName: string;
  key?: string;
}

/** A config `exposes` entry — only the source `file` is needed to build it. */
export interface ExposeInput {
  file: string;
}

/**
 * Derive the side-build entry points from a federation config's `exposes`
 * (M2.1). Mirrors NF's `bundleExposedAndMappings`:
 * `{ fileName: expose.file, outName: key + '.js', key }`. Shared-mappings
 * entries (if still used) are concatenated by the caller.
 */
export function toExposedEntryPoints(
  exposes: Record<string, ExposeInput> = {}
): FederationEntryPoint[] {
  return Object.entries(exposes).map(([key, expose]) => ({
    fileName: expose.file,
    outName: key + '.js',
    key,
  }));
}

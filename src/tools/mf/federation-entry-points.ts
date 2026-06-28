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

/**
 * Derive the side-build entry points from a federation config's `exposes`, whose
 * values are source-path strings: `{ fileName: sourcePath, outName: key + '.js', key }`.
 */
export function toExposedEntryPoints(
  exposes: Record<string, string> = {}
): FederationEntryPoint[] {
  return Object.entries(exposes).map(([key, sourcePath]) => ({
    fileName: sourcePath,
    outName: key + '.js',
    key,
  }));
}

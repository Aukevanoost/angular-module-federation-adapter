import { describe, it, expect } from 'vitest';
import { toExposedEntryPoints } from './federation-entry-points.js';

describe('toExposedEntryPoints', () => {
  it('maps each expose to { fileName, outName: key+".js", key }', () => {
    expect(
      toExposedEntryPoints({
        './Component': './src/app/cmp.ts',
        './service': './src/app/svc.ts',
      })
    ).toEqual([
      { fileName: './src/app/cmp.ts', outName: './Component.js', key: './Component' },
      { fileName: './src/app/svc.ts', outName: './service.js', key: './service' },
    ]);
  });

  it('returns an empty list when there are no exposes', () => {
    expect(toExposedEntryPoints()).toEqual([]);
    expect(toExposedEntryPoints({})).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { getHostExternals } from './get-externals.js';
import { DEFAULT_ANGULAR_SHARED } from '../../index.js';

describe('getHostExternals', () => {
  it('defaults to the Angular singleton set', () => {
    const externals = getHostExternals();
    expect(externals).toEqual(Object.keys(DEFAULT_ANGULAR_SHARED));
    expect(externals).toContain('@angular/core');
    expect(externals).toContain('rxjs');
    expect(externals).toContain('zone.js');
  });

  it('returns the keys of a custom shared map', () => {
    expect(
      getHostExternals({
        '@angular/core': {
          shareConfig: { singleton: true, requiredVersion: false },
        },
      })
    ).toEqual(['@angular/core']);
  });

  it('merges extra externals and de-dupes', () => {
    const externals = getHostExternals(
      { rxjs: { shareConfig: { singleton: true, requiredVersion: false } } },
      ['rxjs', 'date-fns']
    );
    expect(externals).toEqual(['rxjs', 'date-fns']);
  });
});

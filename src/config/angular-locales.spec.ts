import { shareAngularLocales } from './angular-locales.js';

const mockShare = vi.fn((config: unknown) => config);

vi.mock('@softarc/native-federation/config', () => ({
  share: (config: unknown) => mockShare(config),
}));

describe('shareAngularLocales', () => {
  afterEach(() => {
    mockShare.mockClear();
  });

  it('builds a share entry per locale key with the default config', () => {
    const result = shareAngularLocales(['de', 'fr']) as Record<string, unknown>;

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual([
      '@angular/common/locales/de',
      '@angular/common/locales/fr',
    ]);
    expect(result['@angular/common/locales/de']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
      packageInfo: {
        esm: true,
        entryPoint: 'node_modules/@angular/common/locales/de.js',
      },
    });
  });

  it('uses the .mjs extension in legacy mode', () => {
    const result = shareAngularLocales(['de'], { legacy: true }) as Record<
      string,
      { packageInfo: { entryPoint: string } }
    >;

    expect(result['@angular/common/locales/de'].packageInfo.entryPoint).toBe(
      'node_modules/@angular/common/locales/de.mjs'
    );
  });

  it('merges a custom config and its packageInfo overrides', () => {
    const result = shareAngularLocales(['de'], {
      config: {
        singleton: false,
        strictVersion: false,
        requiredVersion: '1.2.3',
        packageInfo: { esm: false, version: '1.2.3' } as never,
      },
    }) as Record<string, Record<string, unknown>>;

    const entry = result['@angular/common/locales/de'];
    expect(entry).toMatchObject({
      singleton: false,
      strictVersion: false,
      requiredVersion: '1.2.3',
    });
    // local packageInfo defaults are spread first, then the custom packageInfo overrides
    expect(entry.packageInfo).toEqual({
      esm: false,
      entryPoint: 'node_modules/@angular/common/locales/de.js',
      version: '1.2.3',
    });
  });

  it('returns an empty map for no keys', () => {
    const result = shareAngularLocales([]) as Record<string, unknown>;
    expect(result).toEqual({});
  });
});

import {
  share,
  shareAll,
  withNativeFederation,
  getDefaultPlatform,
  SERVER_DEPENDENCIES,
} from './share-utils.js';
import { NG_SKIP_LIST } from './angular-skip-list.js';

const mockCoreShare = vi.fn((cfg: unknown) => cfg);
const mockCoreShareAll = vi.fn((cfg: unknown) => cfg);
const mockCoreWithNativeFederation = vi.fn();

vi.mock('@softarc/native-federation/config', () => ({
  DEFAULT_SKIP_LIST: [],
  share: (...args: unknown[]) => mockCoreShare(...args),
  shareAll: (...args: unknown[]) => mockCoreShareAll(...args),
  withNativeFederation: (...args: unknown[]) => mockCoreWithNativeFederation(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('shareAll', () => {
  it('defaults the skipList to NG_SKIP_LIST and delegates to the core implementation', () => {
    const config = { singleton: true } as never;

    shareAll(config);

    expect(mockCoreShareAll).toHaveBeenCalledTimes(1);
    const [passedConfig, passedOpts] = mockCoreShareAll.mock.calls[0]!;
    expect(passedConfig).toBe(config);
    expect(passedOpts.skipList).toBe(NG_SKIP_LIST);
  });

  it('keeps a caller-provided skipList', () => {
    const skipList = ['my-pkg'] as never;

    shareAll({} as never, { skipList, projectPath: '/p' });

    const [, passedOpts] = mockCoreShareAll.mock.calls[0]!;
    expect(passedOpts.skipList).toBe(skipList);
    expect(passedOpts.projectPath).toBe('/p');
  });

  it('returns whatever the core implementation returns', () => {
    const expected = { foo: 'bar' } as never;
    mockCoreShareAll.mockReturnValueOnce(expected);

    expect(shareAll({} as never)).toBe(expected);
  });
});

describe('share', () => {
  it('delegates with default projectPath and NG_SKIP_LIST', () => {
    const config = { rxjs: { singleton: true } } as never;

    share(config);

    expect(mockCoreShare).toHaveBeenCalledWith(config, '', NG_SKIP_LIST);
  });

  it('passes through an explicit projectPath and skipList', () => {
    const skipList = ['x'] as never;

    share({} as never, '/project', skipList);

    expect(mockCoreShare).toHaveBeenCalledWith({}, '/project', skipList);
  });
});

describe('withNativeFederation', () => {
  beforeEach(() => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: true },
      shared: {},
    });
  });

  it('infers the "node" platform when a server dependency is shared', () => {
    withNativeFederation({ shared: { '@angular/ssr': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('infers "node" for secondary entry points of server packages', () => {
    withNativeFederation({ shared: { '@angular/platform-server/init': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('infers the "browser" platform when no server dependency is shared', () => {
    withNativeFederation({ shared: { '@angular/core': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('browser');
  });

  it('does not override an explicitly configured platform', () => {
    withNativeFederation({ platform: 'node', shared: { '@angular/core': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('handles a missing shared config without throwing', () => {
    expect(() => withNativeFederation({} as never)).not.toThrow();
    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('browser');
  });

  it('removes @angular/common/locales entries when ignoreUnusedDeps is disabled', () => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: false },
      shared: {
        '@angular/core': { singleton: true },
        '@angular/common/locales/de': { singleton: true },
        '@angular/common/locales/fr': { singleton: true },
      },
    });

    const result = withNativeFederation({ shared: {} } as never);

    expect(Object.keys(result.shared)).toEqual(['@angular/core']);
  });

  it('keeps locale entries when ignoreUnusedDeps is enabled', () => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: true },
      shared: {
        '@angular/core': { singleton: true },
        '@angular/common/locales/de': { singleton: true },
      },
    });

    const result = withNativeFederation({ shared: {} } as never);

    expect(Object.keys(result.shared)).toEqual([
      '@angular/core',
      '@angular/common/locales/de',
    ]);
  });
});

describe('getDefaultPlatform', () => {
  it.each(SERVER_DEPENDENCIES)('returns "node" when a server dep (%s) is shared', dep => {
    expect(getDefaultPlatform([dep])).toBe('node');
  });

  it('returns "node" for secondary entry points of server deps', () => {
    expect(getDefaultPlatform(['@angular/ssr/node'])).toBe('node');
    expect(getDefaultPlatform(['@angular/platform-server/init'])).toBe('node');
  });

  it('returns "node" when at least one of several deps is a server dep', () => {
    expect(getDefaultPlatform(['@angular/core', 'rxjs', '@angular/ssr'])).toBe('node');
  });

  it('returns "browser" for non-server deps', () => {
    expect(getDefaultPlatform(['@angular/core', 'rxjs', '@angular/common'])).toBe('browser');
  });

  it('returns "browser" for an empty dep list', () => {
    expect(getDefaultPlatform([])).toBe('browser');
  });

  it('returns "browser" for packages that merely contain a server dep name mid-string', () => {
    // matching is prefix-based (startsWith), so this must not match
    expect(getDefaultPlatform(['my-@angular/ssr-wrapper'])).toBe('browser');
  });
});

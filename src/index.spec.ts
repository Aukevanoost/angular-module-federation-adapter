import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the MF runtime: `createInstance` returns a stub instance whose
// `loadRemote` / `registerRemotes` we assert against. (NF orchestrator mocks
// removed — M1.7 port.)
const { createInstance, loadRemote, registerRemotes } = vi.hoisted(() => {
  const loadRemote = vi.fn();
  const registerRemotes = vi.fn();
  const createInstance = vi.fn(() => ({ loadRemote, registerRemotes }));
  return { createInstance, loadRemote, registerRemotes };
});

vi.mock('@module-federation/runtime', () => ({ createInstance }));

beforeEach(() => {
  vi.resetModules();
  createInstance.mockClear();
  loadRemote.mockReset();
  registerRemotes.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initFederation', () => {
  it('creates an MF instance with the default host name + loaded-first strategy', async () => {
    const { initFederation } = await import('./index.js');
    initFederation({});
    const opts = createInstance.mock.calls[0]![0];
    expect(opts.name).toBe('host');
    expect(opts.shareStrategy).toBe('loaded-first');
  });

  it('maps a remotes record to MF { name, entry } entries', async () => {
    const { initFederation } = await import('./index.js');
    initFederation({ a: 'urlA', b: 'urlB' });
    expect(createInstance.mock.calls[0]![0].remotes).toEqual([
      { name: 'a', entry: 'urlA' },
      { name: 'b', entry: 'urlB' },
    ]);
  });

  it('registers the default Angular singleton set as shared', async () => {
    const { initFederation, DEFAULT_ANGULAR_SHARED } = await import('./index.js');
    initFederation({});
    const shared = createInstance.mock.calls[0]![0].shared;
    expect(shared).toMatchObject(DEFAULT_ANGULAR_SHARED);
    expect(shared['@angular/core'].shareConfig).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: false,
    });
  });

  it('merges caller-supplied shared over the defaults', async () => {
    const { initFederation } = await import('./index.js');
    initFederation(
      {},
      { shared: { '@angular/core': { shareConfig: { singleton: false, requiredVersion: false } } } }
    );
    expect(createInstance.mock.calls[0]![0].shared['@angular/core']).toEqual({
      shareConfig: { singleton: false, requiredVersion: false },
    });
  });

  it('passes runtimePlugins and a custom name through', async () => {
    const plugin = { name: 'p' };
    const { initFederation } = await import('./index.js');
    initFederation({}, { name: 'shell', runtimePlugins: [plugin] });
    const opts = createInstance.mock.calls[0]![0];
    expect(opts.name).toBe('shell');
    expect(opts.plugins).toEqual([plugin]);
  });

  it('throws on a bare manifest-URL string (deferred to M1.7 e2e)', async () => {
    const { initFederation } = await import('./index.js');
    expect(() =>
      initFederation('http://x/manifest.json' as unknown as Record<string, string>)
    ).toThrow(/manifest URL string/);
  });
});

describe('loadRemoteModule (instance)', () => {
  it('delegates to mf.loadRemote with `<name>/<expose>`, stripping the leading ./', async () => {
    loadRemote.mockResolvedValue({ ok: 1 });
    const { initFederation } = await import('./index.js');
    const fed = initFederation({ mfe1: 'url' });
    const m = await fed.loadRemoteModule('mfe1', './Component');
    expect(loadRemote).toHaveBeenCalledWith('mfe1/Component');
    expect(m).toEqual({ ok: 1 });
  });

  it('accepts an options object too', async () => {
    loadRemote.mockResolvedValue('M');
    const { initFederation } = await import('./index.js');
    const fed = initFederation({ mfe1: 'url' });
    await fed.loadRemoteModule({ remoteName: 'mfe1', exposedModule: './X' });
    expect(loadRemote).toHaveBeenCalledWith('mfe1/X');
  });

  it('treats a null loadRemote result as a load failure', async () => {
    loadRemote.mockResolvedValue(null);
    const { initFederation } = await import('./index.js');
    const fed = initFederation({ mfe1: 'url' });
    await expect(fed.loadRemoteModule('mfe1', './X')).rejects.toThrow(/null/);
  });

  it('returns a truthy fallback instead of throwing on error', async () => {
    loadRemote.mockRejectedValue(new Error('boom'));
    const { initFederation } = await import('./index.js');
    const fed = initFederation({ mfe1: 'url' });
    const res = await fed.loadRemoteModule({
      remoteName: 'mfe1',
      exposedModule: './X',
      fallback: 'FB',
    });
    expect(res).toBe('FB');
  });

  it('lazy remoteEntry path: resolves name from the manifest, registers, then loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'mfe2' }) })
    );
    loadRemote.mockResolvedValue('LAZY');
    const { initFederation } = await import('./index.js');
    const fed = initFederation();
    const m = await fed.loadRemoteModule({
      remoteEntry: 'http://x/mf-manifest.json',
      exposedModule: './Widget',
    });
    expect(fetch).toHaveBeenCalledWith('http://x/mf-manifest.json');
    expect(registerRemotes).toHaveBeenCalledWith(
      [{ name: 'mfe2', entry: 'http://x/mf-manifest.json' }],
      { force: true }
    );
    expect(loadRemote).toHaveBeenCalledWith('mfe2/Widget');
    expect(m).toBe('LAZY');
  });

  it('throws when neither remoteName nor remoteEntry is given', async () => {
    const { initFederation } = await import('./index.js');
    const fed = initFederation();
    await expect(fed.loadRemoteModule({ exposedModule: './X' })).rejects.toThrow(
      /remoteName/
    );
  });
});

describe('public API', () => {
  it('no longer exports a standalone loadRemoteModule (dropped in M1.3)', async () => {
    const api = await import('./index.js');
    expect((api as Record<string, unknown>).loadRemoteModule).toBeUndefined();
  });
});

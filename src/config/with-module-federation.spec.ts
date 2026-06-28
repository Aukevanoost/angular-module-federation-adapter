import { describe, it, expect } from 'vitest';
import {
  getDefaultPlatform,
  withModuleFederation,
  SERVER_DEPENDENCIES,
} from './with-module-federation.js';

describe('getDefaultPlatform', () => {
  it('returns browser for plain deps', () => {
    expect(getDefaultPlatform(['@angular/core', 'rxjs'])).toBe('browser');
  });

  it('returns node when an Angular server dep is present', () => {
    expect(getDefaultPlatform(['@angular/core', '@angular/ssr'])).toBe('node');
    expect(getDefaultPlatform(['@angular/platform-server'])).toBe('node');
  });

  it('matches secondary entry points via startsWith', () => {
    expect(getDefaultPlatform(['@angular/ssr/node'])).toBe('node');
  });

  it('exposes the server dependency prefixes', () => {
    expect(SERVER_DEPENDENCIES).toContain('@angular/ssr');
    expect(SERVER_DEPENDENCIES).toContain('@angular/platform-server');
  });
});

describe('withModuleFederation', () => {
  it('auto-fills the browser platform and passes name/exposes through', () => {
    const cfg = withModuleFederation({
      name: 'mfe1',
      exposes: { './Cmp': './src/cmp.ts' },
    });
    expect(cfg.name).toBe('mfe1');
    expect(cfg.exposes).toEqual({ './Cmp': './src/cmp.ts' });
    expect(cfg.platform).toBe('browser');
  });

  it('infers node platform from shared server deps', () => {
    const cfg = withModuleFederation({
      name: 'shell',
      shared: { '@angular/ssr': { singleton: true } },
    });
    expect(cfg.platform).toBe('node');
  });

  it('respects an explicit platform override', () => {
    expect(withModuleFederation({ name: 'm', platform: 'node' }).platform).toBe('node');
  });
});

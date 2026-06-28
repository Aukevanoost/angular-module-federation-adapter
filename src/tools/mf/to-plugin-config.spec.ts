import { describe, it, expect } from 'vitest';
import { toMfPluginConfig } from './to-plugin-config.js';

describe('toMfPluginConfig', () => {
  it('maps name, exposes, remotes and defaults the filename', () => {
    const out = toMfPluginConfig({
      name: 'mfe1',
      exposes: { './Cmp': './src/cmp.ts' },
      remotes: { other: 'http://x/mf-manifest.json' },
    });
    expect(out.name).toBe('mfe1');
    expect(out.filename).toBe('remoteEntry.js');
    expect(out.exposes).toEqual({ './Cmp': './src/cmp.ts' });
    expect(out.remotes).toEqual({ other: 'http://x/mf-manifest.json' });
  });

  it('normalizes a shared entry, defaulting booleans and requiredVersion', () => {
    const out = toMfPluginConfig({
      name: 'mfe1',
      shared: { '@angular/core': { singleton: true, strictVersion: true, requiredVersion: '^22.0.0' } },
    });
    expect(out.shared!['@angular/core']).toMatchObject({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^22.0.0',
    });
  });

  it('falls back requiredVersion to "*" and booleans to false when unset', () => {
    const out = toMfPluginConfig({ name: 'm', shared: { rxjs: {} } });
    expect(out.shared!['rxjs']).toMatchObject({
      singleton: false,
      strictVersion: false,
      requiredVersion: '*',
    });
  });

  it('stamps the federation name onto each shared entry so the manifest id is `<name>:<pkg>`', () => {
    // The upstream manifest writer shadows the federation config with the
    // per-package config, reading `config.name` off the shared entry. Carrying
    // the name here makes its `${config.name}:${pkg}` id resolve correctly
    // instead of `undefined:<pkg>` (replaces the old post-build manifest rewrite).
    const out = toMfPluginConfig({ name: 'mfe1', shared: { rxjs: {}, '@angular/core': {} } });
    expect((out.shared!['rxjs'] as { name?: string }).name).toBe('mfe1');
    expect((out.shared!['@angular/core'] as { name?: string }).name).toBe('mfe1');
  });

  it('carries includeSecondaries through (finding #4 — plugin supports it)', () => {
    const out = toMfPluginConfig({
      name: 'm',
      shared: { '@angular/material': { includeSecondaries: true } },
    });
    expect(out.shared!['@angular/material'].includeSecondaries).toBe(true);
  });

  it('honors an explicit filename override', () => {
    expect(toMfPluginConfig({ name: 'm' }, 'entry.js').filename).toBe('entry.js');
  });
});

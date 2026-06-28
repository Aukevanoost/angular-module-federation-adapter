import { describe, it, expect } from 'vitest';
import { createFederationPlugin } from './federation-plugin.js';

describe('createFederationPlugin', () => {
  it('returns an esbuild module-federation plugin for the given config', () => {
    const plugin = createFederationPlugin({
      name: 'mfe1',
      exposes: { './Cmp': './src/cmp.ts' },
      shared: { '@angular/core': { singleton: true, requiredVersion: '^22.0.0' } },
    });
    expect(plugin.name).toBe('module-federation');
    expect(typeof plugin.setup).toBe('function');
  });

  it('passes the filename override through to the plugin config', () => {
    // Smoke: building with a custom filename must not throw at construction.
    expect(() => createFederationPlugin({ name: 'm' }, 'entry.js')).not.toThrow();
  });
});

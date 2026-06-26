import { normalizeContextOptions } from './normalize-context-options.js';

describe('normalizeContextOptions', () => {
  const builderOptions = { someBuilderOption: 1 } as never;
  const context = { workspaceRoot: '/ws' } as never;

  const baseAdapterOptions = {
    entryPoints: [{ fileName: 'a.ts', outName: 'a.js' }],
    external: ['rxjs'],
    outdir: '/out',
    tsConfigPath: 'tsconfig.json',
    mappedPaths: { foo: 'bar' },
    cache: { cachePath: '/cache' },
    dev: true,
    isMappingOrExposed: true,
    hash: true,
    chunks: true,
    platform: 'node',
    optimizedMappings: true,
  } as never;

  it('passes through the provided options unchanged', () => {
    const result = normalizeContextOptions(builderOptions, context, baseAdapterOptions);

    expect(result).toMatchObject({
      builderOptions,
      context,
      entryPoints: [{ fileName: 'a.ts', outName: 'a.js' }],
      external: ['rxjs'],
      outdir: '/out',
      tsConfigPath: 'tsconfig.json',
      mappedPaths: { foo: 'bar' },
      cache: { cachePath: '/cache' },
      dev: true,
      isMappingOrExposed: true,
      hash: true,
      chunks: true,
      platform: 'node',
      optimizedMappings: true,
    });
  });

  it('coerces truthy/falsy flags to real booleans', () => {
    const adapterOptions = {
      ...(baseAdapterOptions as object),
      dev: undefined,
      isMappingOrExposed: undefined,
      hash: undefined,
      optimizedMappings: undefined,
    } as never;

    const result = normalizeContextOptions(builderOptions, context, adapterOptions);

    expect(result.dev).toBe(false);
    expect(result.isMappingOrExposed).toBe(false);
    expect(result.hash).toBe(false);
    expect(result.optimizedMappings).toBe(false);
  });
});

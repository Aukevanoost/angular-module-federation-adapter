import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { OnResolveArgs, OnResolveOptions, PluginBuild } from 'esbuild';

type ResolveHandler = (args: OnResolveArgs) => Promise<{ path?: string; external?: boolean }>;

function setupPlugin(mappedPaths: PathToImport): {
  options: OnResolveOptions;
  handler: ResolveHandler;
} {
  const plugin = createSharedMappingsPlugin(mappedPaths);

  let options!: OnResolveOptions;
  let handler!: ResolveHandler;
  const build = {
    onResolve(opts: OnResolveOptions, cb: ResolveHandler) {
      options = opts;
      handler = cb;
    },
  } as unknown as PluginBuild;

  plugin.setup(build);
  return { options, handler };
}

const MAPPED: PathToImport = {
  '/ws/libs/foo/src/public-api.ts': 'foo-remote',
};

describe('createSharedMappingsPlugin', () => {
  it('registers an onResolve handler for relative imports', () => {
    const { options } = setupPlugin(MAPPED);
    expect(options.filter).toEqual(/^[.]/);
  });

  it('maps a relative import pointing into a shared lib to an external path', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/foo/src/public-api',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('does not externalize imports originating from within the same lib (self-import)', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler({
      kind: 'import-statement',
      resolveDir: '/ws/libs/foo/src',
      path: './public-api',
      importer: '/ws/libs/foo/src/internal.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('ignores non-import-statement kinds', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler({
      kind: 'require-call',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/foo/src/public-api',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('returns an empty result for unmapped relative imports', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: './local-file',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });
});

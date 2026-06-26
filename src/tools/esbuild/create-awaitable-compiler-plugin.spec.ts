import { createAwaitableCompilerPlugin } from './create-awaitable-compiler-plugin.js';

const mockSetup = vi.fn();
const originalPlugin = { name: 'angular-compiler', setup: mockSetup };
const mockCreateCompilerPlugin = vi.fn(() => originalPlugin);

vi.mock('@angular/build/private', () => ({
  createCompilerPlugin: (...args: unknown[]) => mockCreateCompilerPlugin(...args),
}));

describe('createAwaitableCompilerPlugin', () => {
  afterEach(() => {
    mockSetup.mockReset();
    mockCreateCompilerPlugin.mockClear();
  });

  it('forwards plugin options to createCompilerPlugin and keeps the original name', () => {
    const pluginOptions = { jit: false } as never;
    const styleOptions = { workspaceRoot: '/ws' } as never;

    const [plugin] = createAwaitableCompilerPlugin(pluginOptions, styleOptions);

    expect(mockCreateCompilerPlugin).toHaveBeenCalledWith(pluginOptions, styleOptions);
    expect(plugin.name).toBe('angular-compiler');
  });

  it('passes through non-onDispose build properties via the proxy', () => {
    let seenInitialOptions: unknown;
    mockSetup.mockImplementation((build: { initialOptions: unknown }) => {
      seenInitialOptions = build.initialOptions;
      return 'setup-result';
    });

    const [plugin] = createAwaitableCompilerPlugin({} as never, {} as never);
    const realBuild = { initialOptions: { foo: 'bar' }, onDispose: vi.fn() };

    const result = plugin.setup(realBuild as never);

    expect(seenInitialOptions).toEqual({ foo: 'bar' });
    expect(result).toBe('setup-result');
  });

  it('resolves the pluginDisposed promise and runs the user callback on dispose', async () => {
    const userCallback = vi.fn();
    let capturedDisposeCb: (() => void) | undefined;
    const realBuild = {
      onDispose: vi.fn((cb: () => void) => {
        capturedDisposeCb = cb;
      }),
    };

    mockSetup.mockImplementation((build: { onDispose: (cb: () => void) => void }) => {
      build.onDispose(userCallback);
    });

    const [plugin, pluginDisposed] = createAwaitableCompilerPlugin({} as never, {} as never);
    plugin.setup(realBuild as never);

    // the proxy registered a wrapper on the real build exactly once
    expect(realBuild.onDispose).toHaveBeenCalledTimes(1);

    let resolved = false;
    void pluginDisposed.then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);

    // firing esbuild's dispose runs the user callback and resolves the promise
    capturedDisposeCb!();
    await pluginDisposed;

    expect(userCallback).toHaveBeenCalledTimes(1);
  });
});

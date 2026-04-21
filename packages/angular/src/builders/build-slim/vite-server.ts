import { createServer as createViteServer, type InlineConfig, type ViteDevServer } from 'vite';

// Vite accepts connect-style middleware. We only need a loose shape here so
// both the static-file middleware and the federation event middleware fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ViteCompatibleMiddleware = (req: any, res: any, next: () => void) => void;

export interface SlimViteServerOptions {
  root: string;
  port: number | undefined;
  middleware: ViteCompatibleMiddleware[];
}

export async function createSlimViteServer(
  options: SlimViteServerOptions
): Promise<ViteDevServer> {
  const viteConfig: InlineConfig = {
    configFile: false,
    envFile: false,
    appType: 'custom',
    root: options.root,
    publicDir: false,
    mode: 'development',
    server: {
      port: options.port || undefined,
      strictPort: !!options.port,
      cors: { origin: true, preflightContinue: true },
      middlewareMode: false,
      preTransformRequests: false,
      watch: null,
    },
    plugins: [
      {
        name: 'nf-slim-middleware',
        configureServer(server) {
          for (const mw of options.middleware) {
            server.middlewares.use(mw);
          }
        },
      },
    ],
  };

  const viteServer = await createViteServer(viteConfig);
  await viteServer.listen();
  viteServer.printUrls?.();
  return viteServer;
}

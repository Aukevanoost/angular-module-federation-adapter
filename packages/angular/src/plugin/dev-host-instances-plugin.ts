import * as fs from 'fs';
import * as path from 'path';
import type { Plugin } from 'esbuild';

/**
 * Injects the dev-only host-instance bootstrap (see
 * `tools/dev-host-instances-entry.ts`) into the `ng serve` SSR server bundle.
 *
 * Gates on `platform === 'node'`: only SSR projects produce a node-platform
 * esbuild pass, and the serve target carries no `ssr` flag — so this, not an
 * `ssr` option, is the reliable SSR signal. Non-SSR dev servers are a no-op.
 *
 * `inject` makes the bootstrap the first import of every server entry, so its
 * top-level `await` runs before the app. The orchestrator's Node entry is kept
 * external so its `import(url)` stays native and the `module.register()` loader
 * hook fires — if it were bundled, the bridge would silently never run.
 *
 * @param bootstrapSource generated bootstrap module source.
 * @param bootstrapFilePath absolute path to write it to (`inject` needs a file).
 */
export function devHostInstancesPlugin(bootstrapSource: string, bootstrapFilePath: string): Plugin {
  return {
    name: 'nf-dev-host-instances',
    setup(build) {
      const options = build.initialOptions;

      if (options.platform !== 'node') {
        return;
      }

      fs.mkdirSync(path.dirname(bootstrapFilePath), { recursive: true });
      fs.writeFileSync(bootstrapFilePath, bootstrapSource, 'utf-8');

      options.inject = [...(options.inject ?? []), bootstrapFilePath];

      options.external = [
        ...(options.external ?? []),
        '@softarc/native-federation-orchestrator/node',
        '@softarc/native-federation-orchestrator',
      ];
    },
  };
}

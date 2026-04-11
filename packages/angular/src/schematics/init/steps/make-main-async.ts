import type { Rule } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import * as path from 'path';

export function makeMainAsync(
  main: string,
  options: NfSchematicSchema,
  remoteMap: unknown,
  manifestRelPath: string
): Rule {
  return async function (tree) {
    const mainPath = path.dirname(main);
    const bootstrapName = path.join(mainPath, 'bootstrap.ts');

    if (tree.exists(bootstrapName)) {
      console.info(`${bootstrapName} already exists.`);
      return;
    }

    const mainContent = tree.read(main);
    if (mainContent) tree.create(bootstrapName, mainContent);

    const orchestratorImports = `import { initFederation } from '@softarc/native-federation-orchestrator';
import {
  useShimImportMap,
  consoleLogger,
  globalThisStorageEntry,
} from '@softarc/native-federation-orchestrator/options';`;

    const orchestratorOptions = `{
  ...useShimImportMap({ shimMode: true }),
  logger: consoleLogger,
  storage: globalThisStorageEntry,
  hostRemoteEntry: './remoteEntry.json',
  logLevel: 'debug',
}`;

    let newMainContent = '';
    if (options.type === 'dynamic-host') {
      newMainContent = `${orchestratorImports}

initFederation('${manifestRelPath}', ${orchestratorOptions})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`;
    } else if (options.type === 'host') {
      const manifest = JSON.stringify(remoteMap, null, 2).replace(/"/g, "'");
      newMainContent = `${orchestratorImports}

initFederation(${manifest}, ${orchestratorOptions})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`;
    } else {
      newMainContent = `${orchestratorImports}

initFederation({ '${options.project}': './remoteEntry.json' }, ${orchestratorOptions})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`;
    }

    tree.overwrite(main, newMainContent);
  };
}

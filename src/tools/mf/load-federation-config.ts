import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

import type { NormalizedModuleFederationConfig } from '../../config/with-module-federation.js';

/**
 * Load the MF-shaped federation config (the default export of
 * `federation.config.{mjs,js}`). Replaces NF's `normalizeFederationOptions`,
 * which assumed the NF shape (`features`, `sharedMappings`, object `exposes`)
 * and crashed on the MF config.
 */
export async function loadFederationConfig(
  workspaceRoot: string,
  federationConfig: string
): Promise<NormalizedModuleFederationConfig> {
  const fullConfigPath = path.join(workspaceRoot, federationConfig);

  if (!fs.existsSync(fullConfigPath)) {
    throw new Error('Expected ' + fullConfigPath);
  }

  const loaded = (await import(pathToFileURL(fullConfigPath).href)) as {
    default?: NormalizedModuleFederationConfig;
  };

  if (!loaded?.default) {
    throw new Error(
      `Federation config at ${fullConfigPath} must have a default export (the result of withModuleFederation).`
    );
  }

  return loaded.default;
}

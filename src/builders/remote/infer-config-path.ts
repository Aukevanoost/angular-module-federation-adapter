import * as fs from 'fs';
import * as path from 'path';

export function inferFederationConfigPath(tsConfig: string, workspaceRoot: string): string {
  const relProjectPath = path.dirname(tsConfig);
  const mjsRelPath = path.join(relProjectPath, 'federation.config.mjs');

  if (fs.existsSync(path.resolve(workspaceRoot, mjsRelPath))) {
    return mjsRelPath;
  }

  return path.join(relProjectPath, 'federation.config.js');
}

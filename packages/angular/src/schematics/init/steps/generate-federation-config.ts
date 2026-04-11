import { apply, mergeWith, move, template, url } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';

export async function generateFederationConfig(
  remoteMap: Record<string, string>,
  projectRoot: string,
  projectSourceRoot: string,
  appComponentPath: string,
  options: NfSchematicSchema
) {
  const tmpl = url('../files');

  const applied = apply(tmpl, [
    template({
      projectRoot,
      projectSourceRoot,
      appComponentPath,
      remoteMap,
      ...options,
      tmpl: '',
    }),
    move(projectRoot),
  ]);

  return mergeWith(applied);
}

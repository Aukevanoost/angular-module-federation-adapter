import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';

import type { NfSlimBuilderSchema } from './schema.js';

export interface ResolvedNgOptions {
  ngBuilderOptions: ApplicationBuilderOptions;
  projectRoot: string;
  projectSourceRoot: string | undefined;
}

export async function resolveNgBuilderOptions(
  slim: NfSlimBuilderSchema,
  context: BuilderContext,
  outputBase: string,
  tsConfig: string
): Promise<ResolvedNgOptions> {
  const projectMetadata = await context.getProjectMetadata(context.target!.project);
  const projectRoot = (projectMetadata['root'] as string | undefined) ?? '';
  const projectSourceRoot = projectMetadata['sourceRoot'] as string | undefined;

  const ngBuilderOptions: ApplicationBuilderOptions = {
    tsConfig,
    outputPath: outputBase,
    assets: slim.assets,
    stylePreprocessorOptions: slim.stylePreprocessorOptions,
    inlineStyleLanguage: slim.inlineStyleLanguage,
    fileReplacements: slim.fileReplacements,
    sourceMap: slim.sourceMap,
    optimization: slim.optimization,
    preserveSymlinks: slim.preserveSymlinks,
  } as ApplicationBuilderOptions;

  return { ngBuilderOptions, projectRoot, projectSourceRoot };
}

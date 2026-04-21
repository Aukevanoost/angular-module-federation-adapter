import type { JsonObject } from '@angular-devkit/core';
import type { BuildNotificationOptions } from '@softarc/native-federation-runtime';
import type { Plugin } from 'esbuild';
import type { ApplicationBuilderOptions } from '@angular/build';

export type NfSlimIndexOption = string | false | { input: string; output?: string };

export interface NfSlimBuilderSchema extends JsonObject {
  tsConfig: string;
  dev: boolean;
  port: number;
  rebuildDelay: number;
  buildNotifications?: BuildNotificationOptions;
  watch: boolean;
  outputPath?: string;
  projectName?: string;
  verbose?: boolean;
  entryPoints?: string[];
  cacheExternalArtifacts?: boolean;
  index?: NfSlimIndexOption;

  // Passthroughs to the Angular esbuild pipeline / asset copier.
  assets?: ApplicationBuilderOptions['assets'];
  stylePreprocessorOptions?: ApplicationBuilderOptions['stylePreprocessorOptions'];
  inlineStyleLanguage?: ApplicationBuilderOptions['inlineStyleLanguage'];
  fileReplacements?: ApplicationBuilderOptions['fileReplacements'];
  sourceMap?: ApplicationBuilderOptions['sourceMap'];
  optimization?: ApplicationBuilderOptions['optimization'];
  preserveSymlinks?: ApplicationBuilderOptions['preserveSymlinks'];
}

export type NfSlimInternalOptions = { plugins: Plugin[] };

import type { JsonObject } from '@angular-devkit/core';
import type { BuildNotificationOptions } from '@softarc/native-federation-runtime';
import type { Plugin } from 'esbuild';

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
}

export type NfSlimInternalOptions = { plugins: Plugin[] };

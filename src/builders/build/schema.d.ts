import type { JsonObject } from '@angular-devkit/core';
import type { BuildNotificationOptions } from '@softarc/native-federation';
import type { ESMSInitOptions } from 'es-module-shims';
import type { Plugin } from 'esbuild';

export interface NfBuilderSchema extends JsonObject {
  target: string;
  dev: boolean;
  port: number;
  rebuildDelay: number;
  buildNotifications?: BuildNotificationOptions;
  federationConfigPath?: string;
  watch?: boolean;
  skipHtmlTransform: boolean;
  esmsInitOptions: ESMSInitOptions;
  baseHref?: string;
  outputPath?: string;
  projectName?: string;
  ssr: boolean;
  instrumentForCoverage?: boolean;
  codeCoverageExclude?: string[];
  tsConfig?: string;
  devServer?: boolean;
  entryPoints?: string[];
  cacheExternalArtifacts?: boolean;
}

export type NfInternalOptions = { plugins?: Plugin[] };

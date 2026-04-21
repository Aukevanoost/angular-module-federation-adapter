import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - not re-exported from package root
import { normalizeAssetPatterns } from '@angular/build/src/utils/normalize-asset-patterns.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - not re-exported from package root
import { resolveAssets } from '@angular/build/src/utils/resolve-assets.js';

import type { ApplicationBuilderOptions } from '@angular/build';

export type NormalizedAssetEntry = {
  glob: string;
  input: string;
  output: string;
  ignore?: string[];
  followSymlinks?: boolean;
  flatten?: boolean;
};

export function normalizeSlimAssetEntries(
  assets: ApplicationBuilderOptions['assets'] | undefined,
  workspaceRoot: string,
  projectRoot: string,
  projectSourceRoot: string | undefined
): NormalizedAssetEntry[] {
  if (!assets || assets.length === 0) return [];
  return normalizeAssetPatterns(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assets as any,
    workspaceRoot,
    projectRoot,
    projectSourceRoot
  ) as NormalizedAssetEntry[];
}

async function writeAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string,
  changed?: Set<string>
): Promise<void> {
  if (entries.length === 0) return;

  const resolved = (await resolveAssets(entries, workspaceRoot)) as {
    source: string;
    destination: string;
  }[];

  const createdDirs = new Set<string>();
  for (const { source, destination } of resolved) {
    if (changed && !changed.has(source)) continue;

    const dest = path.join(outputDir, destination);
    const dir = path.dirname(dest);
    if (!createdDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    fs.copyFileSync(source, dest, fs.constants.COPYFILE_FICLONE);
  }
}

export function copyAllAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string
): Promise<void> {
  return writeAssets(entries, outputDir, workspaceRoot);
}

export function copyChangedAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string,
  changedFiles: Iterable<string>
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();

  const changed = new Set<string>();
  for (const file of changedFiles) {
    changed.add(path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file));
  }
  if (changed.size === 0) return Promise.resolve();

  return writeAssets(entries, outputDir, workspaceRoot, changed);
}

export function getAssetWatchDirs(
  entries: NormalizedAssetEntry[],
  workspaceRoot: string
): string[] {
  return entries.map(entry => path.resolve(workspaceRoot, entry.input));
}

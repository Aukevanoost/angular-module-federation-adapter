import * as fs from 'fs';
import * as path from 'path';

import type { NfSlimIndexOption } from './schema.js';

const DEFAULT_PLACEHOLDER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Native Federation Remote</title>
</head>
<body>
  <p>This is a Native Federation remote. Load it through a host application.</p>
</body>
</html>
`;

export function writeSlimIndexHtml(
  outputDir: string,
  workspaceRoot: string,
  index: NfSlimIndexOption | undefined
): void {
  if (index === false) return;

  if (index !== undefined) {
    const input = typeof index === 'string' ? index : index.input;
    const outputName = typeof index === 'object' && index.output ? index.output : 'index.html';

    const resolvedInput = path.resolve(workspaceRoot, input);
    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`[slim-builder] Configured index file not found: ${resolvedInput}`);
    }

    const destination = path.join(outputDir, outputName);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(resolvedInput, destination);
    return;
  }

  const indexPath = path.join(outputDir, 'index.html');
  if (fs.existsSync(indexPath)) return;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(indexPath, DEFAULT_PLACEHOLDER, 'utf-8');
}

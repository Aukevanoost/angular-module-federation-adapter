import * as fs from 'fs';

/**
 * Patches `@angular/core` to infer `ngServerMode` at runtime.
 *
 * Usually `ngServerMode` is set during bundling. But because we share a single
 * `@angular/core` bundle across the server and the browser, the value must be
 * inferred at runtime instead.
 *
 * ⚠️ **Extracted from `createAngularBuildAdapter` (M2.3) so it survives the
 * NF adapter factory's deletion.** Phase 4 SSR (M4.1) reuses this exact patch;
 * it was previously a private, non-exported function inside the adapter.
 */
export function setNgServerMode(): void {
  const fileToPatch = 'node_modules/@angular/core/fesm2022/core.mjs';
  const lineToAdd = `if (typeof globalThis.ngServerMode ==='undefined') globalThis.ngServerMode = (typeof window === 'undefined') ? true : false;`;

  try {
    if (fs.existsSync(fileToPatch)) {
      let content = fs.readFileSync(fileToPatch, 'utf-8');
      if (!content.includes(lineToAdd)) {
        content = lineToAdd + '\n' + content;
        fs.writeFileSync(fileToPatch, content);
      }
    }
  } catch {
    console.error('Error patching file ', fileToPatch, '\nIs it write-protected?');
  }
}

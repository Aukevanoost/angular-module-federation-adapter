// M3.2 — Angular skip-list, MF-native. Two NF couplings broken vs the old file:
//   (1) `SkipList` type + `DEFAULT_SKIP_LIST` base now come from
//       `@module-federation/esbuild` (deep import, Breakage-A-free, like M3.1)
//       instead of `@softarc/native-federation/config`;
//   (2) the self-listed package paths are the **renamed** package, not the old
//       `@angular-architects/native-federation*`.
// The `@angular/localize*`, `*/upgrade`, `*/testing`, `@nx/angular`, and `zone.js`
// entries carry over unchanged.
import {
  type SkipList,
  DEFAULT_SKIP_LIST,
} from '@module-federation/esbuild/dist/lib/core/default-skip-list.js';

export const NG_SKIP_LIST: SkipList = [
  ...DEFAULT_SKIP_LIST,
  '@angular-architects/module-federation-esbuild',
  '@angular-architects/module-federation-esbuild/config',
  '@angular-architects/module-federation-esbuild/internal',
  'zone.js',
  '@angular/localize',
  '@angular/localize/init',
  '@angular/localize/tools',
  '@angular/router/upgrade',
  '@angular/common/upgrade',
  /^@nx\/angular/,
  (pkg) => pkg.startsWith('@angular/') && !!pkg.match(/\/testing(\/|$)/),
];

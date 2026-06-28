# Constraints & known issues

Things worth knowing when working on or adopting the adapter. These are properties
of the current design and its dependencies, not a to-do list.

## es-module-shims is required

`@module-federation/esbuild`'s emitted container shares modules through
**es-module-shims import maps** — it calls the `importShim` global. es-module-shims
is therefore a hard dependency and must be loaded on the page (via the polyfills).
It is *not* an optional shim that can be removed; the runtime depends on it. (This
is also why server-side rendering is not currently supported — Node has no
`importShim`. See the [SSR proposal](./research/ssr-proposal-future.md).)

## `@module-federation/esbuild` is an early (`0.0.x`) line

The build integration is the least-mature dependency. Two concrete defects are
worked around in the codebase:

- **The high-level `./build` entry crashes on import** (a `json5` named-export bug).
  The adapter avoids it entirely: it uses the `./plugin` subpath for the plugin and
  **deep imports** `dist/lib/config/*` for the config helpers (`withFederation`,
  `share`, `shareAll`, the skip-list).
- **The generated container imports `@module-federation/webpack-bundler-runtime`**,
  which is an *undeclared* transitive dependency. It must be listed explicitly.

⚠️ Those deep `dist/lib/config/*` imports reach into `0.0.x` internals and may move
between versions — re-verify them whenever the dependency is bumped. A graduation
to `0.1.x`/`1.x` would be the strongest signal that this risk has eased.

## The federation build writes to disk (`write: true`)

The MF plugin's `onEnd` reads the emitted container back off disk to inject the
exposed module map, so the side build runs esbuild with `write: true` (unlike the
in-memory Angular build path). Emitted files are read from the build metafile.

## Single Angular instance

Shared framework packages (`@angular/*`, `rxjs`, `zone.js`) must resolve to a single
instance or Angular throws `NG0203`. The adapter registers a default Angular shared
set as strict singletons; the scaffolded config also shares `@angular/core` with its
secondary entry points.

## Open questions

- **Shared partial-ivy libraries** (e.g. `@angular/material`): MF's nested
  shared-bundling step is commonjs-only and does no Angular *linking*, so whether
  partial-ivy component libraries link correctly when shared is unconfirmed.
- **Native (non-shim) import maps**: the container hardcodes `importShim`, so the
  `shimMode: false` path that NF added may not be viable here.

## Verification status

The adapter is **statically verified** — it type-checks, lints, and passes its unit
tests. Its **end-to-end behaviour is not yet proven**: a real Angular host loading a
remote in a browser (single instance / no `NG0203`), interop with a stock
webpack/rspack host, and `ng serve` incremental rebuilds all need to be exercised in
a real Angular workspace. i18n's artifact handling is implemented but its runtime
(`localize-translate`) path is likewise unverified.

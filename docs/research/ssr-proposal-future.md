# Proposal / Issue: SSR support for `@angular-architects/module-federation-esbuild`

> Status: **deferred to post-v1** (decision 2026-06-28). See also
> [Architecture](../architecture.md) and [Constraints & known issues](../known-issues.md).
> Labels: `enhancement`, `ssr`, `blocked`, `research`

## Summary

Server-side rendering of MF-esbuild remotes has **no proven path today**. This is
an *architectural* blocker, not merely a missing implementation. v1 ships
**CSR-only**; this issue tracks the research + design needed to add SSR later.

## Background

Native Federation (the package this adapter is migrating from) supported Angular
SSR via a Node-side federation loader. The migration swapped the build engine to
`@module-federation/esbuild` and the runtime to `@module-federation/runtime`,
which (finding #6 of the migration) share modules through **es-module-shims import
maps** — the emitted `remoteEntry.js` container calls `importShim.addImportMap(...)`.

## The blocker

1. **`importShim` is browser-only.** MF-esbuild's emitted container requires the
   `importShim` global (es-module-shims). **Node SSR has no `importShim`**, so
   importing a remote container server-side throws
   `ReferenceError: importShim is not defined` (reproduced in the M0.1 spike when
   importing `remoteEntry.js` under Node). The browser container simply cannot
   initialise in Node as-is.

2. **`@module-federation/node` is webpack-coupled.** The obvious candidate
   (`@module-federation/node`, latest `2.7.45`) declares peer
   `webpack: ^5.40.0`. It expects webpack-shaped containers and runtime, not
   MF-esbuild's es-module-shims-based ones — so it is not a drop-in for this
   esbuild build.

3. **No esbuild-side Node loader exists.** NF avoided the problem with a real Node
   ESM loader: `initNodeFederation` + `module.register()` installed a server-side
   loader **before** `@angular/*` was pulled in, resolving shares without a browser
   container. MF-esbuild ships no equivalent.

## What NF did (the three pieces to replace)

- **`src/node-preload.ts`** (~161 lines) — a Node `--import` preload that calls
  `module.register()` to install NF's server-side ESM loader *before* `@angular/*`
  loads, then publishes startup state on two globals
  (`__NF_HOST_SERVER_LOADER__`, `__NF_FEDERATION_STATUS__`) and honours an
  `NF_REQUIRE_REMOTES` env contract. An MF redesign must reproduce the
  *register-loader-before-Angular* ordering and pick its own status/handshake.
- **`src/plugin/dev-host-instances-plugin.ts`** (~40 lines) — esbuild `Plugin`
  that injects the dev-only bridge entry into the dev-server build.
- **`src/tools/ssr/dev-host-instances-entry.ts`** (~150 lines) — the injected
  dev-only singleton-bridge body.

These still import `initNodeFederation` from
`@softarc/native-federation-orchestrator/node`, which is **why the `@softarc`
orchestrator dependency cannot be removed until SSR is redesigned** (see
[Constraints & known issues](../known-issues.md)).

## Already in place

- **`setNgServerMode`** is extracted to `src/tools/esbuild/set-ng-server-mode.ts`
  (migration M2.3) and ready for whichever SSR path. It patches `@angular/core`'s
  `fesm2022/core.mjs` to infer `ngServerMode` at runtime, because the same shared
  `@angular/core` bundle serves both browser and server.

## Proposed research avenues (pick one to prototype)

1. **es-module-shims Node shim / `importShim` polyfill.** Provide a minimal Node
   implementation of `importShim` (+ `addImportMap`/`getImportMap`) so the emitted
   container can initialise server-side. Lowest-divergence from the browser path;
   risk = faithfully emulating es-module-shims import-map semantics in Node.
2. **Custom MF Node loader.** A `module.register()`-based loader (NF-style) that
   resolves MF shares from the `mf-manifest.json` directly, bypassing the browser
   container entirely. Most control; most work.
3. **Wait for / contribute an esbuild-aware `@module-federation/node`.** Track
   upstream; the esbuild adapter is `0.0.x` and evolving.

## Acceptance criteria (when SSR is picked up)

- [ ] An Angular SSR host renders a federated remote component server-side with
      **no `ReferenceError: importShim`** and **no `NG0203`** (single Angular
      instance across the SSR boundary).
- [ ] Dev SSR (`ng serve` with SSR) bridges host singletons to remotes.
- [ ] The `@softarc/native-federation-orchestrator` dependency is removed (its
      only remaining users are the three SSR pieces above).
- [ ] `node-preload` ordering (loader-before-Angular) reproduced for prod SSR.

## Recommendation

**Defer to post-v1.** Ship CSR host+remote first (the bulk of the value, and the
only path with a viable architecture today). Revisit SSR once a loader strategy
above is prototyped against a real Angular SSR app.

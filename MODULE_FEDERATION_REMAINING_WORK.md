# Remaining Work — `@angular-architects/module-federation-esbuild`

> Companion to `MODULE_FEDERATION_MIGRATION.md`. Snapshot date: 2026-06-28.
> Purpose: hand off the **deferred / blocked** work to a future session that has a
> **real Angular workspace + browser** (the thing this sandbox lacks).

## Status snapshot

The NF→MF migration is **code-complete and statically verified** (typecheck + eslint
+ knip clean; **81 unit tests green**) for everything that can be checked without
running Angular:

- **Phase 1 (runtime)** ✅ — `src/index.ts` is a pure MF rewrite over
  `@module-federation/runtime` (`initFederation`/`loadRemoteModule`). 13 tests.
- **Phase 2 (build)** ✅ — both builders drive the MF side build
  (`createMfFederationBuilder`: Angular compiler ctx + `moduleFederationPlugin`,
  one-pass, `write:true`). NF build engine + dead code removed.
- **Phase 3 (config/schematics)** mostly ✅ — `withModuleFederation` + MF skip-list +
  template + migrations reset; `index.ts`/`config` barrel are pure MF; knip clean.

**Every phase gate (M0.G–M3.G) is CONDITIONAL** — see blockers below.

## The two blockers that gate everything left

### Blocker A — no real Angular app / browser here
All the empirical proofs were deferred for this reason. **Verification checklist**
for a future session (run an Angular host + a webpack/rspack-built MF remote):

1. **Single Angular instance / no `NG0203`** (the M0.2/M0.G/M1.7 verdict): host
   `initFederation(...)` → `loadRemoteModule('remote','./Cmp')` → bootstrap the
   remote standalone component; assert host & remote share the **same**
   `@angular/core` identity. `NG0203` ⇒ two copies ⇒ late gate failure.
2. **CSR build emit** (M2.2): run the builder against a real app; confirm
   `remoteEntry.js` + `mf-manifest.json` + chunks land in `browserOutputPath`, and
   the plugin's `onEnd` container rewrite works under `write:true`.
3. **Webpack/rspack interop** (M0.4): a stock webpack host consumes the Angular
   remote, and vice-versa (`remoteEntry.type:"esm"` vs webpack's `"global"`/`var`).
4. **`ng serve` incremental rebuild** (M2.6): edit an exposed component → MF rebuild
   fires, SSE reload triggers.
5. **Shared partial-ivy lib linking** (M2.3): share e.g. `@angular/material`. NF's
   deleted `node-modules-bundler` did Angular **linking**; MF's nested shared build
   is **commonjs-only**. Open question whether partial-ivy libs link correctly.
6. **`shimMode:false`** (M2.5): MF's container hardcodes `importShim`, so the native
   import-map path may be non-viable — decide keep/remove.

### Blocker B — `@softarc/*` is load-bearing infra, not just "the engine"
**M3.5's "remove all `@softarc`" cannot close** until this is reimplemented. The
engine swap deliberately **reused** NF's infrastructure. Still imported in ~24 files:

| Reused NF piece | From | Used by | MF replacement effort |
|---|---|---|---|
| `normalizeFederationOptions` (config loader → `normalized.config/options`) | `@softarc/native-federation` | both builders | port config loader |
| `createFederationCache` + `FederationCache`/`SourceFileCache` | same | builders + MF driver's cache invalidation | port cache |
| `getExternals` | same | both builders | trivial (already have `getHostExternals`) |
| `RebuildQueue`, `createNfWatcher`, `syncNfFileWatcher`, `AbortedError`, `logger`, `getDefaultCachePath` | `@softarc/native-federation/internal` | watch + rebuild orchestration | port orchestration internals |
| types: `EntryPoint`, `FederationInfo`, `NFBuildAdapterOptions` | `@softarc/*` | `normalize-context-options.ts`, builders | local types (mostly done in `tools/mf/*`) |
| `initNodeFederation` (orchestrator) | `@softarc/native-federation-orchestrator` | SSR (`node-preload`, `dev-host-instances-entry`) | **gated on SSR** (see `docs/ssr-proposal-future.md`) |

⇒ Wholesale removal = porting NF's config/cache/watch layer locally (large, mostly
runtime-unverifiable) **plus** the SSR orchestrator (gated on the deferred SSR work,
`docs/ssr-proposal-future.md`).

## Remaining tasks (top-to-bottom)

### M3.3 leftover renames (mechanical, low-risk)
Still point at the old package / NF, not load-bearing:
- `schematics/init/steps/add-dependencies.ts` — install the MF deps
  (`@module-federation/{runtime,sdk,webpack-bundler-runtime}@2.6.0` +
  `esbuild@0.0.109`), drop `@softarc/*`. (Couples with M3.5.)
- `schematics/init/steps/update-package-json.ts` — NF `patch-angular-build.js` path.
- `schematics/remove/schematic.ts` — keep the es-module-shims/polyfill stripping
  **symmetric** with install. ⚠️ es-module-shims **STAYS** (finding #6), so the
  remove path must not over-strip it as a dependency, only undo what install added.
- Cosmetic: rename `src/generators/native-federation/` dir + `collection.json` paths.

### M3.5 — `@softarc` infra reimplementation (the big one)
See Blocker B. Suggested order: getExternals (done) → local types → cache → config
loader → watch/rebuild internals → then drop the `package.json` `@softarc/*` deps.

### Phase 4 (optional for v1)
- **M4.1 SSR — deferred to post-v1.** Architecturally blocked (MF-esbuild's container needs
  the browser-only `importShim`, which Node SSR lacks). Full analysis, the NF pieces to
  replace, research avenues, and acceptance criteria are written up as a standalone issue:
  **`docs/ssr-proposal-future.md`**. Not part of v1.
- **M4.2 i18n** — ✅ artifact-name rework **done**: `copyRemoteEntry` → `copyFederationArtifacts`
  copies `remoteEntry.js` + `mf-manifest.json` per locale (spec updated, 9 tests). **Remaining:**
  run the actual `localize-translate` CLI against a real i18n Angular build; re-verify
  `shareAngularLocales` (`config/angular-locales.ts`, 1 `@softarc` import → M3.5); and
  optionally replace the transitional `toFederationInfoForI18n()` shim in `build/builder.ts`
  with a first-class MF artifact-file list. Optional for v1.
- **M4.3 scope decision** — given M4.1, the rational v1 boundary is **CSR host+remote
  ships; SSR + i18n deferred.**

### Docs (M3.6 tail) — write LAST
Rewrite `README.md`/`MIGRATION_GUIDE.md`/`AGENTS.md` only **after** the API surface
stabilizes and the Blocker-A e2e is green — documenting a non-working package misleads.

## Key findings to carry forward
- **Finding #6** — MF-esbuild shares via **es-module-shims import maps** (`importShim`),
  the same mechanism as NF. ⇒ es-module-shims **STAYS** a dep + on the page.
- **`requiredVersion:'auto'` IS supported** by MF-esbuild's config layer
  (`lookupVersion`) — contra parts of M3.1's table.
- **`includeSecondaries` IS supported** by the plugin (finding #4).
- **Deep config import** `@module-federation/esbuild/dist/lib/config/*` bypasses
  **Breakage A** (the `/build` entry's `json5` crash) — used by `withModuleFederation`
  + the MF skip-list. ⚠️ 0.0.x internal paths; re-verify on version bump.
- **`write:true` required** for the side build (the plugin's `onEnd` reads the
  container off disk).
- **Breakage B** — the generated container imports `@module-federation/webpack-bundler-runtime`
  (undeclared); must stay a dependency.
- **Dominant risk** — `@module-federation/esbuild` is still `0.0.109` (npm `latest`);
  re-check each pass — a jump to 0.1.x/1.x would be the biggest de-risking signal.

## Suggested order of attack (for a future session)

1. **Stand up a real Angular workspace** (host app + a remote, or a stock webpack
   remote). Without this, none of the gates can close — it is the critical path.
2. **Run the Blocker-A verification checklist** top to bottom. Item 1 (no `NG0203`)
   is the make-or-break: if Angular isn't a clean singleton over MF, reassess before
   investing further. Fix any one-pass-emit / linking / `shimMode` issues surfaced.
3. **Finish the M3.3 leftover renames** (mechanical) — quick wins, unblock a clean
   `ng add`.
4. **Tackle M3.5** — port NF's config/cache/watch infra in the suggested order so the
   `@softarc/*` deps can finally be dropped (orchestrator excepted — SSR-gated).
5. **Close gates M0.G–M3.G** with the now-green e2e + clean `@softarc` removal.
6. **Decide v1 scope (M4.3)** and ship CSR. Then write the user-facing docs (M3.6
   tail) against the now-verified surface.
7. **Post-v1:** pick up SSR (`docs/ssr-proposal-future.md`) and the i18n runtime
   verification (M4.2 remainder).

## Map of what was built (where to look)

- Runtime: `src/index.ts` (+ `src/index.spec.ts`).
- MF build driver: `src/tools/mf/` (`build-for-federation.ts`, `federation-side-build.ts`,
  `federation-plugin.ts`, `to-plugin-config.ts`, `federation-entry-points.ts`).
- Angular compiler ctx (with `write`/`extraPlugins` hooks): `src/tools/esbuild/angular-bundler.ts`.
- Config DSL: `src/config/with-module-federation.ts`, `src/config/angular-skip-list.ts`.
- Externals helper: `src/builders/build/get-externals.ts`.
- SSR patch (ready): `src/tools/esbuild/set-ng-server-mode.ts`.
- Wired builders: `src/builders/build/builder.ts`, `src/builders/remote/builder.ts`.

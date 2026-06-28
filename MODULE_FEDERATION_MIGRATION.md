# Build Plan: `@angular-architects/module-federation-esbuild`

> Status: actionable build/migration plan (loop-friendly)
> Scope: turn this repo into a **new, standalone** Angular adapter for Module Federation v2,
> built on `@module-federation/runtime` + `@module-federation/esbuild`. This is a clean-break
> package — it does **not** need to interop with native-federation or keep NF's deps. The
> native-federation code in `src/` is the **template to port from**, then delete.
> Date: 2026-06-28
> Companion docs: `docs/research/deep-research-module-federation.md`,
> `docs/research/plan-module-federation-angular-adapter.md`

## How to use this file

Each task is a checkbox with a stable `[Mx.y]` id. Work top-to-bottom; do not start a
phase until the previous phase's **Gate** is checked. When a task is done, tick its box and
add a one-line note (PR #, commit, or finding) on the line beneath it. Phase 0 is a
**go/no-go gate** — if it fails, stop and reassess; do not write Angular glue.

Effort/risk legend: 🟢 low · 🟡 medium · 🔴 high/decisive.

---

## 0. The migration in one picture

```
                         BEFORE (this repo today)            AFTER (target)
  runtime / orchestrator src/index.ts                        src/index.ts (same public API)
                         → @softarc/native-federation-          → @module-federation/runtime
                           orchestrator                           (createInstance/registerRemotes/
                         → es-module-shims + import maps           loadRemote/loadShare)
                                                                + es-module-shims + import maps STAY
                                                                  (MF-esbuild uses them internally —
                                                                   see Phase 0 finding #6)
  ───────────────────────────────────────────────────────────────────────────────────────
  build core / manifest  @softarc/native-federation             @module-federation/esbuild
                         buildForFederation / rebuildFor…       moduleFederationPlugin (side build)
                         → remoteEntry.json                     → remoteEntry.js + mf-manifest.json
  ───────────────────────────────────────────────────────────────────────────────────────
  esbuild adapter        tools/esbuild/angular-esbuild-         folded into the MF plugin; we keep
                         adapter.ts (NFBuildAdapter)            only the Angular-build side-channel
  ───────────────────────────────────────────────────────────────────────────────────────
  config                 withNativeFederation / share /         withModuleFederation / share /
                         shareAll (config/share-utils.ts)       shareAll (same names, MF mapping)
  ───────────────────────────────────────────────────────────────────────────────────────
  Angular glue           builders/, i18n.ts, update-index-      KEEP — re-pointed at MF artifacts
                         html.ts, dev-server middleware,        (this is the bulk of the value and
                         schematics                             most of it survives the swap)
```

**Decision already made (from `plan-module-federation-angular-adapter.md` §2.1):** do **not**
let the MF plugin own Angular's main build. Run Angular's `ApplicationBuilder` for the app
shell and run `@module-federation/esbuild` as a **separate side build** we control — exactly
the dual-build pattern `builders/build/builder.ts` already implements for NF.

**Clean-break ground rules (resolved):**
- This is a **new package** (`@angular-architects/module-federation-esbuild`), not a migration
  of an installed NF app. No dual-engine, no NF runtime on the page, no backwards-compat with
  `@softarc/*`. All NF deps get removed wholesale (Phase 3).
- The NF `src/` is a **reference implementation**: port the Angular glue (builders, dev server,
  i18n, schematics) and delete the NF-specific engine underneath it.
- Keeping the **public API shape** (`initFederation`, `loadRemoteModule`, `withModuleFederation`)
  familiar to NF users is a *nice-to-have for adoption*, not a hard constraint — design the
  cleanest MF-native API and only mimic NF where it's genuinely better.

---

## Phase 0 — De-risk (go/no-go gate) 🔴

Goal: prove `@module-federation/esbuild` (currently **v0.0.109** — a 0.0.x line, this is the
#1 risk) carries Angular-shaped payloads and that shared `@angular/core` resolves to a single
instance. **No Angular adapter code in this phase.**

- [~] **[M0.1]** Spike repo (under `spike/`): one MF remote exposing a
  trivial stateful module, one host, both plain esbuild + `moduleFederationPlugin`. Confirm
  `loadRemote` works and a shared singleton keeps state across host↔remote.
  - ✅ **Build half done (2026-06-28):** `spike/remote` builds with esbuild 0.28.1 +
    `moduleFederationPlugin` and emits valid MF v2 artifacts — `remoteEntry.js`, `mf-manifest.json`,
    and the exposed `counter` chunk, **0 errors**. See live findings below.
  - ⚠️ **Runtime half can't run headless:** the emitted container requires `importShim` (es-module-shims) —
    `import()`ing `remoteEntry.js` in Node throws `ReferenceError: importShim is not defined` (finding #6).
    Confirming host `loadRemote` + cross-boundary state needs es-module-shims in a browser; deferred to M1.7.
- [~] **[M0.2]** Escalate to the real risk: externalize + share `@angular/core` and
  `@angular/common` between two esbuild bundles; bootstrap a trivial standalone component from
  the remote into the host. Confirm **one** Angular instance (no `NG0203`).
  - Singleton config must be `singleton: true, strictVersion: true` for all `@angular/*`,
    `rxjs`, `zone.js` (or zoneless).
  - **Resolved-by-equivalence, empirically deferred (see M0.G verdict):** finding #6 shows MF-esbuild shares
    via es-module-shims import maps — NF's exact mechanism — so the single-instance question reduces to NF's
    solved case. The live render needs a browser (none in this sandbox); moved to the M1.7 e2e. Not a hard fail.
- [~] **[M0.3]** Confirm version/tooling compatibility with this repo: MF pins `esbuild@0.28.1`
  (repo is `^0.28.0` ✅ — **verified on npm 2026-06-28**), bundles `@chialab/esbuild-plugin-commonjs`
  (repo already uses it ✅), and `@module-federation/runtime@2.6.0` (`sdk` + `webpack-bundler-runtime` are
  **version-locked to the same `2.6.0`** — install all pinned together in M1.1). Note any CJS→ESM
  double-handling breakage.
  - ✅ **Done where the spike could reach:** esbuild 0.28.1 + the plugin build cleanly together. Two real
    0.0.x defects surfaced (Breakages A & B, above). **CJS→ESM double-handling was NOT exercised** — the M0.1
    module is pure ESM; this risk only bites with CJS deps (e.g. some `@angular/*` secondaries) and must be
    re-checked once a real Angular build runs in Phase 2.
- [ ] **[M0.4]** Document the minimal `mf-manifest.json` an Angular host must emit to be
  consumed by a stock webpack/rspack MF host, and vice-versa.

  **Real `mf-manifest.json` emitted by the M0.1 spike** (esbuild 0.28.1 + `@module-federation/esbuild@0.0.109`,
  captured 2026-06-28 — this is actual output, not a sketch; `shared`/`exposes` annotations show what M0.2 adds):
  ```jsonc
  {
    "id": "remote",                       // == name; the share-scope identity
    "name": "remote",
    "metaData": {
      "name": "remote",
      "type": "app",                      // "app" | "remote"
      "buildInfo": { "buildVersion": "", "buildName": "remote" },   // buildVersion empty unless configured
      "remoteEntry": { "name": "remoteEntry.js", "path": "dist", "type": "esm" },  // ← actual value is "esm"
      "types": { "path": "", "name": "", "zip": "@mf-types.zip", "api": "@mf-types.d.ts" },
      "globalName": "remote",
      "pluginVersion": "0.0.109",         // the adapter stamps its own version
      "publicPath": "auto"                // ← key is `publicPath` (not `pubPath`); CORS still required (see risks)
    },
    "shared": [],                         // EMPTY in M0.1 (no shared); M0.2 adds @angular/core etc. here
    "remotes": [],
    "exposes": [
      { "id": "remote:counter", "name": "counter", "path": "./counter",  // id is `<name>:<key-sans-./>`
        "assets": { "js": { "async": [], "sync": [] }, "css": { "async": [], "sync": [] } } }
    ]
  }
  ```
  Interop checks: (a) `remoteEntry.type` is **`"esm"`** for the ESM output the adapter emits — a stock
  webpack host defaults to `"global"`/`var`, so cross-loading requires matching `library.type`; (b) the
  `shared[].version`/`requiredVersion` Angular emits (populated once M0.2 adds `@angular/*` to `shared`) must
  overlap what the webpack/rspack host shares, or strict-version negotiation rejects the singleton; (c)
  round-trip the **other** direction too — confirm an Angular host can read a webpack-emitted manifest.

**Spike recipe (concrete M0.1 → M0.2 path).** Keep it under `spike/` and throw it away after the gate.

```
spike/
  remote/  build.mjs  src/expose.ts   (M0.1: stateful module; M0.2: standalone component)
  host/    build.mjs  src/main.ts     (loadRemote + bootstrap)
```

1. **M0.1 — does MF-over-esbuild work at all?** Remote exposes a stateful counter; host `loadRemote`s
   it and mutates state. Both built with `@module-federation/esbuild`'s `moduleFederationPlugin`:
   ```js
   // remote/build.mjs
   import { moduleFederationPlugin } from '@module-federation/esbuild';
   import * as esbuild from 'esbuild';
   await esbuild.build({
     entryPoints: ['src/expose.ts'], bundle: true, format: 'esm', outdir: 'dist',
     plugins: [moduleFederationPlugin({
       name: 'remote', filename: 'remoteEntry.js',
       exposes: { './counter': './src/expose.ts' },
       shared: {},                       // empty for M0.1; fill in step 2
     })],
   });
   ```
   Host registers the remote via `@module-federation/runtime` (`createInstance` + `loadRemote('remote/counter')`).
   **Pass:** state set in the host survives a round-trip through the remote module (proves one module graph).

2. **M0.2 — the decisive test: one Angular instance.** Add `@angular/core` + `@angular/common` to **both**
   `shared` maps as strict singletons, externalize them from each bundle, and have the remote export a
   standalone component the host bootstraps:
   ```js
   shared: {
     '@angular/core':   { singleton: true, strictVersion: true, requiredVersion: '<pin exact installed>' },
     '@angular/common': { singleton: true, strictVersion: true, requiredVersion: '<pin exact installed>' },
     'rxjs':            { singleton: true, strictVersion: true },
     'zone.js':         { singleton: true, strictVersion: true },   // omit if testing zoneless
   }
   ```
   **Pass / FAIL signal:** bootstrap the remote component into the host and watch the console.
   `NG0203: inject() must be called from an injection context` (or two `ɵɵdefineInjectable` registrations)
   = **two Angular copies = gate FAILED.** Clean render with shared DI = gate passed. Add an assertion:
   the host and remote must observe the **same** `@angular/core` module identity (e.g. compare a symbol
   pinned on a core export, or that a root-provided service is the same instance across the boundary).

3. **M0.3 sanity during the spike:** note whether MF's internal `cjsToEsmPlugin` double-handles anything
   Angular's build already converted, and confirm `esbuild@0.28.x` resolves without peer conflicts.

**Gate [M0.G]:** If shared Angular core cannot be a clean singleton over MF (M0.2 — `NG0203` or two core
copies), **STOP** — the migration is in doubt. Record the failure mode and reassess. Do not proceed to Phase 1.
- [x] **Gate: CONDITIONAL PASS — proceed to Phase 1 (verdict 2026-06-28).**

  **Reasoning.** The gate's purpose is to kill the project early if Angular can't be a clean MF singleton.
  The spike resolved the *dominant* risk by discovering the mechanism (finding #6): `@module-federation/esbuild`
  shares modules via **es-module-shims import maps — the identical mechanism Native Federation already uses to
  share a single `@angular/core` in production.** The singleton question therefore reduces to NF's already-solved
  case, not an unproven new path. Combined with the build half working (artifacts emit cleanly on esbuild 0.28.1),
  the architecture is sound enough to invest in Phase 1.

  **What is NOT yet empirically proven (and why it's acceptable to proceed):** the live host-load + no-`NG0203`
  render (M0.2) was not executed — it requires es-module-shims running in a **browser**, and this sandbox has no
  browser driver and no Angular installed. This is *execution-environment* missing, not a *technical blocker*.
  The faithful confirmation now lives in **M1.7** (Angular host consumes an MF remote under `ng serve` / a browser
  e2e), where es-module-shims + a real Angular app exist naturally. **If M1.7's first e2e shows `NG0203`, treat it
  as a late gate failure** and reassess before building further.

  **Residual risks carried forward:** the two 0.0.x defects (Breakages A & B) and the es-module-shims-stays
  correction (M1.4/M1.6/M3.5 below).

### Live spike findings (2026-06-28) — first contact with `@module-federation/esbuild@0.0.109`

What the spike actually surfaced (esbuild 0.28.1, Node, pnpm with `--ignore-workspace`):

1. ✅ **The plugin works on our esbuild.** `moduleFederationPlugin` (from the **`./plugin`** subpath)
   builds a remote and emits `remoteEntry.js` + `mf-manifest.json` + the exposed chunk with 0 errors.
   Drive it via `esbuild.build({ bundle:true, format:'esm', splitting:true, metafile:true,
   plugins:[moduleFederationPlugin(config)] })`; the plugin injects `remoteEntry.js` as a virtual
   container entry, forces `metafile`, derives `external` from `config`, and writes the manifest in `onEnd`.
2. 🔴 **Breakage A — the high-level API is unusable as shipped.** `import('@module-federation/esbuild/build')`
   (the entry that re-exports `withNativeFederation` / `share-utils` / `getExternals` / `loadFederationConfig`)
   **throws on import**: `The requested module 'json5' does not provide an export named 'parse'` — a CJS/ESM
   named-import defect in 0.0.109. Workaround: use the `./plugin` subpath directly. **File upstream.**
   (Confirm whether it also reproduces inside the workspace install; it reproduced in the isolated spike.)
3. 🔴 **Breakage B — undeclared runtime dependency.** The generated container `import`s
   `@module-federation/webpack-bundler-runtime`, which is **not** a (transitive) dep of
   `@module-federation/esbuild@0.0.109`. The build fails with `Could not resolve
   "@module-federation/webpack-bundler-runtime"` until you add it explicitly (used `@2.6.0`). **Any Angular
   consumer's `package.json` must include `@module-federation/webpack-bundler-runtime`** — fold into M1.1.
4. 💡 **Big one for Phase 3 — an NF-derived config layer already exists upstream.**
   `@module-federation/esbuild` ships `withNativeFederation`, `share`/`shareAll`, a skip-list, and
   `getExternals`, and its `NormalizedFederationConfig`/`SharedConfig` types natively support
   `singleton`/`strictVersion`/`requiredVersion`/`version`/`eager`/`includeSecondaries`, plus top-level
   `skip` and `sharedMappings`. This **contradicts the M3.1 table's "no MF equivalent" call for
   `includeSecondaries`** (it IS supported here) and means much of M3.1/M3.2 may be *re-export + thin
   wrapper* rather than a from-scratch port. Re-audit M3.1 against `dist/lib/config/*` before porting.
5. 📌 **M0.4 corrected from real output** (see the manifest above): emitted `remoteEntry.type` is `"esm"`
   (not `"module"`), the key is `publicPath` (not `pubPath`), and the manifest carries `pluginVersion`.
6. 🚨 **HEADLINE — `@module-federation/esbuild` runs on es-module-shims + import maps.** The emitted
   `remoteEntry.js` contains a built-in runtime plugin named **`"import-maps-plugin"`** whose `init`
   builds an import map of `data:text/javascript` virtual modules and calls
   **`importShim.addImportMap(...)`** / `importShim.getImportMap()` (lines ~4587–4608 of the emitted
   entry). `importShim` is the **es-module-shims** global. Importing the entry in Node fails with
   `ReferenceError: importShim is not defined` (confirmed 2026-06-28) — the container cannot initialise
   without es-module-shims on the page. **This means the MF-esbuild adapter uses the *same* es-module-shims
   + import-map sharing mechanism as Native Federation, just behind an MF-shaped API and `mf-manifest.json`.**

   **Consequences — this reframes the whole plan:**
   - ✅ *De-risks the gate.* The singleton mechanism is identical to NF's proven one, so "single Angular
     instance" should behave exactly as it already does under NF (see M0.G verdict).
   - ❌ *Invalidates the "remove es-module-shims" tasks.* M1.4, M1.6, and M3.5 assumed MF replaces import-map
     injection with a native shareScope and that `es-module-shims` gets deleted. **It does not** — es-module-shims
     stays as the underlying loader. Those tasks are corrected below.
   - 🔁 *The migration is narrower than thought:* swap NF's orchestrator + `remoteEntry.json` for MF's runtime +
     `mf-manifest.json`, **keeping** the es-module-shims/import-map foundation — not a loader replacement.

**Updated immediate next step:** the build half of M0.1 is proven and the architectural risk is resolved by
equivalence (finding #6). The *empirical* host-load + single-instance run (M0.1 runtime half + M0.2) requires
**es-module-shims in a browser** — this sandbox has no browser driver and no Angular installed, so that
confirmation is moved into the Phase 1 `ng serve` / browser e2e (M1.7), where a real Angular app + es-module-shims
exist naturally. See the M0.G verdict for the reasoning.

---

## Phase 1 — Consumer (host) runtime: the orchestrator swap 🟢 (highest value, lowest risk)

Goal: an Angular **host** loads existing MF v2 remotes. This is the core "migrate the
orchestrator" work and likely the real prize on its own.

- [ ] **[M1.1]** Add deps: `@module-federation/runtime@2.6.0`, `@module-federation/esbuild@0.0.109`,
  `@module-federation/sdk@2.6.0`, **and `@module-federation/webpack-bundler-runtime@2.6.0`** (the last is an
  **undeclared** dep the emitted container imports — proven required in the M0.1 spike, Breakage B). Keep
  `runtime`/`sdk`/`webpack-bundler-runtime` on the **same** `2.6.0` (they ship locked; verified 2026-06-28).
  ⚠️ **Keep `es-module-shims`** (finding #6 — MF-esbuild needs it). Stage removal only of `@softarc/native-federation`,
  `@softarc/native-federation-orchestrator` (full removal in Phase 3).
- [ ] **[M1.2]** Write `src/index.ts` `initFederation()` over `@module-federation/runtime`:
  `createInstance({ name, remotes })` + `registerRemotes(...)`. Use NF's signature
  (`initFederation(remotesOrManifestUrl?, options?)` → `{ loadRemoteModule, ... }`) as the
  *starting shape* for adoption familiarity, but drop NF-only options (`shimMode`) and add
  MF-native ones; design the cleanest surface, don't preserve NF quirks for their own sake.
- [ ] **[M1.3]** Write `loadRemoteModule()` delegating to runtime `loadRemote(...)`. Keep the
  useful ergonomics from NF (arg-normalization, `remoteEntry`-only lazy path, `fallback`
  semantics). The module-scoped `federationPromise` (`index.ts:58`) + standalone
  `loadRemoteModule` (`:154`–`:205`) was an NF compromise — and the standalone export is **already
  `@deprecated` in its JSDoc** (`:144`–`:153`) in favour of the instance-returned `loadRemoteModule`.
  That deprecation is a strong signal: in the MF rewrite, prefer dropping the module-scoped promise
  entirely and returning `loadRemoteModule` only from the `initFederation` instance.
- [ ] **[M1.4]** Register the host's `@angular/*` (+ `rxjs`, `zone.js`) as MF singletons. ⚠️ **Corrected by
  M0.1 finding #6:** this does **not** "replace NF's import-map injection" — MF-esbuild's share scope IS
  implemented *with* es-module-shims import maps (the container's `import-maps-plugin` calls
  `importShim.addImportMap`). So registering singletons here still flows through es-module-shims; the change
  vs NF is the *manifest/registration API*, not the loader. (Maps to research §96 "Register Shared Singletons".)
- [ ] **[M1.5]** Builder (host path): externalize shared deps from the Angular build (the
  `externals` plugin in `builders/build/builder.ts:298–313` already does this for NF — re-point
  it at the MF shared set). No container needed for a pure host.
- [ ] **[M1.6]** ⚠️ **Heavily revised by M0.1 finding #6 — es-module-shims STAYS.** Do **not** delete the
  shim loader. MF-esbuild's runtime depends on `importShim` (`ReferenceError` without it). What you *can* still
  drop is the NF-specific *orchestration* of it: the NF-only `useShimImportMap`/`useDefaultImportMap` helpers and
  the `InitFederationOptions.shimMode` option (MF manages the import map internally via `import-maps-plugin`).
  Keep `es-module-shims` as a dependency and keep loading it on the page (M2.5/polyfills). The
  `vite:import-analysis`/`es-module-shims` stderr filter (`builder.ts:64`) likely still applies — re-verify, don't
  delete blindly. Net: this task shrinks from "remove the shim layer" to "stop hand-managing import maps".
- [ ] **[M1.7]** Tests: port/extend `src/index.spec.ts` for the MF runtime. Add an e2e: Angular
  host consumes a webpack/rspack-built MF remote.

**Target `src/index.ts` API sketch (M1.2/M1.3 working draft).** Keeps NF's call shape for adoption
familiarity, drops `shimMode`/import-map options, and returns `loadRemoteModule` from the instance
(per M1.3 — no module-scoped promise). Refine against the real `@module-federation/runtime` types.

```ts
// Mirrors NF's existing signature shape (index.ts:65) minus the NF-only bits.
export interface InitFederationOptions {
  /** MF runtime plugins (replaces NF's shimMode/esmsInitOptions). */
  runtimePlugins?: FederationRuntimePlugin[];
  /** Override the default share scope name. */
  shareScope?: string;
}

export interface FederationInstance {
  loadRemoteModule<T = unknown>(remoteName: string, exposed: string): Promise<T>;
  loadRemoteModule<T = unknown>(opts: { remoteName: string; exposedModule: string }): Promise<T>;
  /** lazy: load by remoteEntry URL without prior registration (kept from NF ergonomics). */
  loadRemoteModule<T = unknown>(opts: { remoteEntry: string; exposedModule: string }): Promise<T>;
}

// remotes: a static map, an mf-manifest.json URL, or nothing (register later).
export function initFederation(
  remotes?: Record<string, string> | string,
  options?: InitFederationOptions,
): FederationInstance;            // NF returns a Promise; MF createInstance is sync — prefer sync + lazy loadRemote.
```

- The standalone `loadRemoteModule` export is **dropped** (it was `@deprecated` already — M1.3); consumers
  destructure from the `initFederation` return. If a one-import migration aid is wanted, re-export a thin
  wrapper but mark it deprecated from day one.
- `fallback` semantics (NF) → map onto MF `loadRemote`'s error path or a `runtimePlugins` `errorLoadRemote` hook.

**Gate [M1.G]:** Angular host loads a third-party MF v2 remote (CSR), single Angular instance,
public API unchanged. Ship this as a standalone deliverable.
- [ ] Gate passed + note

---

## Phase 2 — Producer (remote) build 🟡

Goal: Angular **produces** remotes consumable by any MF v2 host.

> ⚠️ **There are TWO builders, not one.** `buildForFederation` / `rebuildForFederation` /
> `setBuildAdapter` / `RebuildQueue` appear in **both** `builders/build/builder.ts` (the app
> shell / host path, 708 lines) **and** `builders/remote/builder.ts` (the dedicated remote
> path, 229 lines — `buildForFederation` at `:125`, `rebuildForFederation` at `:172`,
> `setBuildAdapter` at `:63`, `RebuildQueue` at `:137`). Every Phase-2 swap below must be
> applied to **both** or the remote builder silently keeps calling NF. The remote path also has
> its own helpers: `builders/remote/{change-watcher,resolve-ng-options,infer-config-path,assets}.ts`.

- [ ] **[M2.1]** Wire the side esbuild build with `moduleFederationPlugin({ name, filename,
  exposes, shared })`, replacing the `buildForFederation`/`rebuildForFederation` calls in
  **both** builders: `build/builder.ts:425` & `:551`, and `remote/builder.ts:125` & `:172`.
  Drive it from the same orchestration loop.
- [ ] **[M2.2]** Emit `remoteEntry.js` + `mf-manifest.json` into Angular's browser output dir
  (`browserOutputPath`, `builder.ts:246`). Reconcile MF's output naming/hashing with Angular's
  layout (`outputOptions`, `:227`).
- [ ] **[M2.3]** Retire `tools/esbuild/angular-esbuild-adapter.ts` and `setBuildAdapter` — the MF
  plugin owns the side build now. The concrete thing to drop is the **`createAngularBuildAdapter`
  factory** (`:62`), which returns the NF-typed `NFBuildAdapter` contract (`NFBuildAdapter` is an
  imported *type* from `@softarc/native-federation`, not a local symbol). Keep only what the side
  build still needs from `tools/esbuild/*` (tsconfig creation, shared-mappings if still relevant).
  ⚠️ `setNgServerMode` (`:45`) is a **private, non-exported** function called from inside the factory
  (`:100`); Phase 4 SSR (M4.1) wants to reuse it, so extract/re-export it before deleting the factory.
- [ ] **[M2.4]** Re-point the dev-server middleware (`builder.ts:352–401`) to serve
  `remoteEntry.js` + MF chunks with CORS (logic survives; only filenames change).
- [ ] **[M2.5]** Update `index.html` script wiring: `update-index-html.ts` `updateScriptTags` (`:32`)
  injects an `<script type="esms-options">` tag (`:44`, `shimMode: true` by default) and rewrites the
  `polyfills` (`:47`) and `main` (`:54`) script tags to `type="module"` / `type="module-shim"` — all
  es-module-shims plumbing. ⚠️ **Reassessed after finding #6:** since es-module-shims STAYS, most of this
  plumbing is **still required** (MF-esbuild's `importShim` calls need es-module-shims loaded and configured).
  Likely keep the `esms-options` tag and the `module-shim` rewrites; the change is reconciling `shimMode` and
  any MF-specific bootstrap, not removing the tags. Verify against a real MF host before editing; update
  `update-index-html.spec.ts` accordingly.
- [ ] **[M2.6]** Preserve incremental rebuild DX: `RebuildQueue` + `createNfWatcher` watch sync
  (`builder.ts:495–626`) must drive the MF side build's rebuilds, or `ng serve` DX regresses.
- [ ] **[M2.7]** SSE reload path: **mostly survives the swap unchanged** — verified, lower risk than
  it reads. `federation-build-notifier.ts` is an artifact-*agnostic* SSE manager (`text/event-stream`
  connection pool) that just signals "rebuild happened, reload" — no artifact name baked in.
  `setup-builder-env-variables.ts` only sets `NG_BUILD_PARALLEL_TS=0` (an Angular build tweak,
  **unrelated** to federation artifacts or SSE — was miscategorized here). The only artifact-coupled
  piece is `update-index-html.ts` (covered by M2.5). Net: re-point nothing here except confirm the
  notifier still fires after the MF side build completes.

**Gate [M2.G]:** Angular-built remote (CSR) is consumed by a stock webpack/rspack MF host;
`ng serve` rebuilds the remote on change.
- [ ] Gate passed + note

---

## Phase 3 — Config + schematics parity, and NF removal 🟢

- [ ] **[M3.1]** `withModuleFederation(config)` mirroring `withNativeFederation`
  (`config/share-utils.ts`): same `share` (`:27`) / `shareAll` (`:15`) / skip-list / `getDefaultPlatform`
  (`:58`) surface, mapped onto MF `shared` semantics (`singleton`/`strictVersion`/`requiredVersion`/`eager`).
  **NF-only fields that DON'T map 1:1 to MF — each needs an explicit decision** (drawn from the live
  scaffold template): `build: 'package'` (NF build mode — no MF equivalent), `requiredVersion: 'auto'`
  (NF resolves the installed version; MF wants a concrete range or `false`), `includeSecondaries`
  (NF secondary-entrypoint control), and the `features` block (`denseChunking`, `ignoreUnusedDeps` —
  both NF remoteEntry-metadata optimizations with no MF counterpart). Decide: translate, no-op, or reject.
  Note the existing `platform` mechanism: `withNativeFederation` (`:35`) auto-fills `cfg.platform` via
  `getDefaultPlatform`, which flips to `'node'` when `SERVER_DEPENDENCIES`
  (`['@angular/platform-server', '@angular/ssr']`, `:52`) are present. MF has no direct `platform`
  concept — decide whether to keep this as an Angular-side build hint (drives the SSR side build / shared
  set) or drop it; it ties into Phase 4 SSR.

  **NF → MF config mapping (M3.1 working table).** MF columns reflect the stable webpack/`@module-federation`
  `shared` contract; ⚠️ confirm the exact option names the `@module-federation/esbuild` **0.0.x** plugin
  actually honours against its source before relying on this (see dominant risk below).

  | NF field (`share`/`shareAll`/config) | MF `shared` equivalent | Mapping notes |
  |---|---|---|
  | `singleton: true` | `singleton: true` | 1:1. Mandatory for all `@angular/*`, `rxjs`, `zone.js`. |
  | `strictVersion: true` | `strictVersion: true` | 1:1. Pairs with `singleton` to surface `NG0203` early. |
  | `requiredVersion: 'auto'` | `requiredVersion: '<range>'` | **No `'auto'` in MF.** Resolve the installed version at config-build time and emit a concrete range, or set `false` to disable the check. |
  | `requiredVersion: '^x.y.z'` | `requiredVersion: '^x.y.z'` | 1:1 when already an explicit range. |
  | `eager` | `eager` | 1:1 (rare for Angular; avoid for framework libs). |
  | `version` (explicit) | `version` | 1:1. |
  | `build: 'package'` \| `'src'` | — | **No MF equivalent.** NF build-mode hint; drop — the MF side build decides bundling. |
  | `includeSecondaries` / `{ keepAll }` | `includeSecondaries` (supported!) | **Spike-corrected:** `@module-federation/esbuild`'s `SharedConfig` has a native `includeSecondaries` field — NOT "no equivalent". The `{ keepAll }` object form may need flattening to a boolean; verify against `dist/lib/config/share-utils`. |
  | `pkgInfo` / NF auto-discovery | (plugin auto-resolves) | MF resolves versions from the dep graph; drop NF's discovery shim. |
  | top-level `skip: [...]` | omit from `shared` | MF has no skip-list; "skipping" = simply not listing the package as shared (see M3.2). |
  | `features.denseChunking` | — | **No MF equivalent** (NF `remoteEntry.json` metadata packing). Drop. |
  | `features.ignoreUnusedDeps` | — | **No MF equivalent.** MF shares only what's listed, so this is implicitly the default. Drop. |
  | `platform` (`browser`\|`node`) | — (build-side hint) | Keep Angular-side only; drives SSR side build + shared set. Not an MF `shared` key. |
  | top-level `name` | plugin `name` | 1:1. |
  | top-level `exposes` | plugin `exposes` | 1:1 shape; value paths reused. |

- [ ] **[M3.2]** Angular skip-list equivalent of `config/angular-skip-list.ts` for MF. Two NF couplings
  to break: (1) it imports both the `SkipList` **type** and the `DEFAULT_SKIP_LIST` base from
  `@softarc/native-federation/config` (`:1`) — reimplement both locally or map to MF's exclusion model;
  (2) `NG_SKIP_LIST` self-lists the **old** `@angular-architects/native-federation*` package paths
  (`:5`–`:7`) — update to the renamed package. The `@angular/localize*`, `*/upgrade`, and
  `*/testing` predicate entries carry over as-is.
- [ ] **[M3.3]** Rework schematics: `init`, `appbuilder`, the generator
  (`generators/native-federation/` → rename), and `federation.config.mjs__tmpl__` to scaffold MF
  config (`federation.config.*`). Rename `init` artifacts to the new package name.
  - ⚠️ The current template (`schematics/init/files/federation.config.mjs__tmpl__`) still imports from
    **`@angular-architects/native-federation/config`** — i.e. the scaffolded config points at the *old*
    NF package, not this renamed one. Re-point the import and the `withNativeFederation`→`withModuleFederation` call.
  - The template carries **NF-only config fields with no direct MF equivalent** (see M3.1) — when you
    rewrite it, each needs a decision, not a 1:1 copy: `build: 'package'`, `requiredVersion: 'auto'`,
    `includeSecondaries: { keepAll: true }` on `@angular/core`, and `features: { denseChunking, ignoreUnusedDeps }`
    (the `denseChunking` comment even references `remoteEntry.json`, an NF artifact name).
  - Don't forget the **`remove` schematic** (`schematics/remove/schematic.ts`, the `ng remove` uninstall
    path): it reverses the M3.5 polyfill injection with the same two code paths — strips
    `import 'es-module-shims';` (`:128`) and the polyfills-array entry (`:136`). Update it in lockstep so
    uninstall stays symmetric with install. (The `appbuilder` schematic at `appbuilder/schematic.ts:41`
    flips the builder back to `@angular/build:application` — verify it points at the renamed builder.)
- [ ] **[M3.4]** Reset `ng update` migrations: this is a new package starting at its own version,
  so `schematics/update18`/`update22` + `migration-collection.json` should be cleared/replaced —
  no NF→MF upgrade path is owed. (Optional: a *separate* one-shot "switch from NF" codemod, but
  it is out of scope for v1.)
- [ ] **[M3.5]** Remove NF deps + dead code: `@softarc/native-federation*` and the import-map types in
  `index.ts` (`Imports`/`Scopes`/`ImportMap`). ⚠️ **Corrected by M0.1 finding #6: do NOT remove
  `es-module-shims`** — `@module-federation/esbuild`'s runtime requires the `importShim` global, so it stays
  a dependency *and* stays injected by the polyfills step. Leave `updatePolyfills.ts`'s two es-module-shims
  injection paths (`updatePolyfillsFile`/`updatePolyfillsArray`) **in place** (they may need re-pointing, not
  deleting). Update `package.json` exports (drop NF-shaped entries), `knip.json`, `collection.json`,
  `builders.json`. Net: the "wholesale es-module-shims removal" is cancelled; only the `@softarc/*` engine goes.
- [ ] **[M3.6]** Rewrite `README.md`, `MIGRATION_GUIDE.md`, `AGENTS.md` for the new package.
  `package.json` is **partly** renamed already: `name` is `@angular-architects/module-federation-esbuild`
  (v22.0.2) and `repository` points at the `Aukevanoost/angular-module-federation-adapter` fork — but
  `homepage` still reads `https://github.com/native-federation/angular-adapter` (fix it), and the four
  `exports` subpaths (`.`, `./config`, `./internal`, `./node-preload`) plus `files` must be reconciled
  with the final MF surface.

**Gate [M3.G]:** `ng add @angular-architects/module-federation-esbuild` + `ng g host/remote`
produce a working MF host+remote pair; `knip` and `lint` clean; no `@softarc/*` references remain
anywhere. (⚠️ `es-module-shims` **does** remain — finding #6 — so it is *not* part of the clean-out;
only the `@softarc/*` NF engine must be gone.)
- [ ] Gate passed + note

---

## Phase 4 — SSR + i18n (long tail, optional for v1) 🔴

- [ ] **[M4.1]** SSR: evaluate `@module-federation/node` against Angular's server build pass and
  the `ngServerMode` shared-bundle patch (`angular-esbuild-adapter.ts:setNgServerMode`, see M2.3's
  extract-before-delete note). Treat as research; the dev-SSR singleton bridge needs an MF
  equivalent designed from scratch. The three NF pieces to replace, with their actual mechanics:
  - `node-preload.ts` (161 lines) — a Node `--import` preload that calls `module.register()` to
    install NF's server-side ESM loader **before** `@angular/*` is pulled in, then publishes startup
    state via two global keys (`__NF_HOST_SERVER_LOADER__` = `SERVER_LOADER_GLOBAL_KEY`,
    `__NF_FEDERATION_STATUS__` = `FEDERATION_STATUS_GLOBAL_KEY`) and honours an `NF_REQUIRE_REMOTES`
    env contract. The MF redesign must reproduce this *register-loader-before-Angular* ordering and
    pick its own status/handshake mechanism.
  - `plugin/dev-host-instances-plugin.ts` (40 lines) — esbuild `Plugin` (`:21`) that injects the
    entry below into the dev server build.
  - `tools/ssr/dev-host-instances-entry.ts` (150 lines) — the injected dev-only bridge body.
- [ ] **[M4.2]** i18n: replicate `translateFederationArtifacts` (`builders/build/i18n.ts:40`)
  against MF artifact names. ⚠️ `copyRemoteEntry` (`:104`) **hard-codes `remoteEntry.json`**, copying
  it from the source locale into each `browser/<locale>/remoteEntry.json` (`:108`); under MF this must
  copy `remoteEntry.js` **and** `mf-manifest.json` per locale instead. Entry point is `getI18nConfig`
  (`:31`); translation runs via Angular's `localize-translate` CLI (`:85`). Re-verify `shareAngularLocales`
  (`config/angular-locales.ts:3`).
- [ ] **[M4.3]** Decide v1 scope: CSR host+remote ships without SSR/i18n if needed.

---

## Cross-cutting risks (keep visible every loop)

- 🔴 **`@module-federation/esbuild` is 0.0.x (v0.0.109).** Least-exercised MF build integration;
  no stated production-readiness. Budget for filing/forking/patching upstream. This is the
  dominant risk, not architecture. **Verified against npm 2026-06-28: `0.0.109` is still the `latest`
  dist-tag** — the package has not graduated past 0.0.x, so the risk is current, not a stale reading.
  Re-check this each loop; a jump to 0.1.x / 1.x would be the single biggest de-risking signal.
  **Two concrete 0.0.x defects already hit in the M0.1 spike** (see Phase 0 live findings): (A) the
  `./build` high-level entry throws on import (`json5` named-export bug) — must use `./plugin`; (B) the
  emitted container needs `@module-federation/webpack-bundler-runtime`, an **undeclared** dependency.
  Both are workaroundable but confirm the "budget for patching upstream" framing is real, not theoretical.
- 🔴 **`NG0203` (single Angular instance).** Any version skew or double-bundle of `@angular/core`
  trips it. Strict singleton config + Phase-0 proof is mandatory.
- 🟡 **Two builds in lockstep.** Angular's build + the MF side build must keep externals/shared
  perfectly in sync or framework copies duplicate.
- 🟡 **CJS double-handling.** Angular's CJS→ESM + MF's `cjsToEsmPlugin` (`esbuild.build()`
  internally) can collide.
- 🟡 **MF runtime version governance.** Host + remotes must agree on a compatible
  `@module-federation/runtime` major (cross-team burden NF avoided via the browser).
- 🟡 **Clean-break adoption.** As a brand-new package there is no installed base — first
  consumers are early adopters. Get a working CSR host+remote published early to gather feedback.
- 🟡 **Angular privates treadmill (unchanged).** Still importing `@angular/build/private`
  (`buildApplicationInternal`, `serveWithVite`, `SourceFileCache`) — same per-major maintenance.
- ℹ️ **CORS is NOT bypassed** despite common MF claims — manifest/chunk fetches still need CORS.

## Source anchors in this repo (what each phase touches)

Verified against the tree on 2026-06-28 — line numbers checked live.

- `src/index.ts` — runtime API to keep identical (Phase 1).
- `src/builders/build/builder.ts` (708 lines) — app-shell/host dual-build orchestration: es-module-shims
  stderr filter (`:64`), externals plugin (`:297`–`:303`), `outputOptions` (`:227`),
  `browserOutputPath` (`:246`), dev-server middleware, `buildForFederation` (`:425`),
  `RebuildQueue` (`:495`), `rebuildForFederation` (`:551`) (Phases 1, 2).
- `src/builders/remote/builder.ts` (229 lines) — **separate** remote build path with its own
  `setBuildAdapter` (`:63`), `buildForFederation` (`:125`), `RebuildQueue` (`:137`),
  `rebuildForFederation` (`:172`); helpers `change-watcher.ts`, `resolve-ng-options.ts`,
  `infer-config-path.ts`, `assets.ts` (Phase 2 — must be swapped in lockstep with `build/builder.ts`).
- `src/tools/esbuild/` — `angular-esbuild-adapter.ts` (`NFBuildAdapter` + `setNgServerMode`, retire
  in Phase 2 / reuse SSR patch in Phase 4) plus `angular-bundler.ts`, `node-modules-bundler.ts`,
  `shared-mappings-plugin.ts`, `create-federation-tsconfig.ts`, `create-awaitable-compiler-plugin.ts`
  (audit each: keep what the MF side build still needs, drop NF-only pieces).
- `src/config/share-utils.ts` + `src/config/angular-skip-list.ts` + `src/config/angular-locales.ts` —
  config surface (Phase 3; locales also Phase 4).
- `src/builders/build/update-index-html.ts` + `i18n.ts` + `federation-build-notifier.ts` +
  `setup-builder-env-variables.ts` — index wiring, i18n, SSE reload (Phases 2, 4).
- `src/plugin/dev-host-instances-plugin.ts` + `src/node-preload.ts` +
  `src/tools/ssr/dev-host-instances-entry.ts` — dev-SSR singleton bridge (Phase 4).
- `src/schematics/*` (`init/` with 12 `steps/`, `appbuilder/`, `remove/`, `update18/`, `update22/`)
  + `src/generators/native-federation/` — scaffolding/migration (Phase 3; `remove/` = the `ng remove`
  uninstall path the doc previously omitted).

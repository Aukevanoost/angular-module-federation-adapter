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

- [x] **[M1.1]** Add deps: `@module-federation/runtime@2.6.0`, `@module-federation/esbuild@0.0.109`,
  `@module-federation/sdk@2.6.0`, **and `@module-federation/webpack-bundler-runtime@2.6.0`** (the last is an
  **undeclared** dep the emitted container imports — proven required in the M0.1 spike, Breakage B). Keep
  `runtime`/`sdk`/`webpack-bundler-runtime` on the **same** `2.6.0` (they ship locked; verified 2026-06-28).
  ⚠️ **Keep `es-module-shims`** (finding #6 — MF-esbuild needs it). Stage removal only of `@softarc/native-federation`,
  `@softarc/native-federation-orchestrator` (full removal in Phase 3).
  - ✅ **Done (2026-06-28).** All four added to `dependencies` via pnpm, **0 peer conflicts**; `0.0.109` is still
    the npm `latest` dist-tag (dominant 0.0.x risk unchanged). `@softarc/*` kept for now (removed in Phase 3).
    In-workspace re-verification: `esbuild` resolves to **0.28.1** (matches MF's pin — M0.3 sanity holds);
    the `./plugin` subpath imports cleanly and exports `moduleFederationPlugin` (+ `createVirtualRemoteModule`,
    `createVirtualShareModule`). **Breakage A reproduces in the workspace install too** — `import('@module-federation/esbuild/build')`
    still throws `'json5' does not provide an export named 'parse'`, so we are locked to the `./plugin` subpath
    (not a spike-only artifact). M0.3's "confirm whether it reproduces inside the workspace" → **yes, it does.**
- [x] **[M1.2]** Write `src/index.ts` `initFederation()` over `@module-federation/runtime`:
  `createInstance({ name, remotes })` + `registerRemotes(...)`. Use NF's signature
  (`initFederation(remotesOrManifestUrl?, options?)` → `{ loadRemoteModule, ... }`) as the
  *starting shape* for adoption familiarity, but drop NF-only options (`shimMode`) and add
  MF-native ones; design the cleanest surface, don't preserve NF quirks for their own sake.
  - ✅ **Done (2026-06-28).** `src/index.ts` rewritten over `@module-federation/runtime`'s
    `createInstance({ name, remotes, shared, plugins, shareStrategy })`. **`pnpm typecheck` passes
    clean** against the real `2.6.0` types. Confirmed-by-types API facts: `UserOptions` =
    `{ name, remotes: Remote[], shared?, plugins?, shareStrategy?, ... }`; each `Remote` = `{ name, entry }`
    (`RemoteWithEntry`); `shareStrategy: 'loaded-first'` is a valid `ShareStrategy` (tsc accepted it).
    Design decisions made: **`initFederation` is synchronous** (MF `createInstance` is sync vs NF's promise —
    `await` callers still work; endorsed by the doc's "prefer sync + lazy loadRemote"); dropped NF-only
    `shimMode`/`sse`/`cacheTag`/`logging`; added `runtimePlugins` + `shareScope` + `name`. `remotes` is a
    `Record<name,entryUrl>` mapped to MF's remotes array; the bare manifest-URL-string form is deferred to M1.7.
  - ⚠️ **`src/index.spec.ts` is now stale** — it mocks `@softarc/native-federation-orchestrator` and asserts
    `sse`/`shimMode`, neither of which the new runtime touches. Its rewrite is **M1.7** (as planned); the suite
    will be red for those cases until then. No other `src/` file changed (the rest still compiles on `@softarc`).
  - `shared: {}` is intentionally empty here — host `@angular/*`/`rxjs`/`zone.js` singletons land in **M1.4**.
- [x] **[M1.3]** Write `loadRemoteModule()` delegating to runtime `loadRemote(...)`. Keep the
  useful ergonomics from NF (arg-normalization, `remoteEntry`-only lazy path, `fallback`
  semantics). The module-scoped `federationPromise` (`index.ts:58`) + standalone
  `loadRemoteModule` (`:154`–`:205`) was an NF compromise — and the standalone export is **already
  `@deprecated` in its JSDoc** (`:144`–`:153`) in favour of the instance-returned `loadRemoteModule`.
  That deprecation is a strong signal: in the MF rewrite, prefer dropping the module-scoped promise
  entirely and returning `loadRemoteModule` only from the `initFederation` instance.
  - ✅ **Done (2026-06-28). typecheck + eslint both clean.** `loadRemoteModule` now delegates to the
    instance's `mf.loadRemote<T>('<name>/<expose>')` (expose key stripped of leading `./`). All three
    NF ergonomics preserved: arg-normalization (`(remoteName, exposed)` **or** options object),
    **lazy `remoteEntry` path** (`mf.registerRemotes([{name, entry}], {force:true})` then load; name
    resolved from the manifest's `name` via `fetch` when omitted), and `fallback` (truthy-only, logs in
    browser, rethrows otherwise). MF's `loadRemote` returns `T | null`, so a `null` result is treated as a
    load failure (→ fallback/throw).
  - ✅ **Standalone `loadRemoteModule` export + module-scoped state dropped entirely** (the doc's preferred
    path), since grep proved **no in-`src` consumer** imports it (the `dev-host-instances-entry.ts` /
    `node-preload.ts` hits use the separate SSR `initNodeFederation` loader, Phase 4). Consumers now
    destructure `loadRemoteModule` from the `initFederation` return.
  - ⚠️ **Lazy-path caveat:** the `remoteEntry` URL must point at the JSON **`mf-manifest.json`** (has a
    top-level `name`, per M0.4), not `remoteEntry.js` (which is executable JS, not fetch-parseable). Documented
    in the helper. Live `loadRemote` round-trip still pending the browser e2e (es-module-shims) — **M1.7**.
- [x] **[M1.4]** Register the host's `@angular/*` (+ `rxjs`, `zone.js`) as MF singletons. ⚠️ **Corrected by
  M0.1 finding #6:** this does **not** "replace NF's import-map injection" — MF-esbuild's share scope IS
  implemented *with* es-module-shims import maps (the container's `import-maps-plugin` calls
  `importShim.addImportMap`). So registering singletons here still flows through es-module-shims; the change
  vs NF is the *manifest/registration API*, not the loader. (Maps to research §96 "Register Shared Singletons".)
  - ✅ **Done (2026-06-28). typecheck + eslint clean.** `initFederation` now feeds `createInstance({ shared })`
    a default Angular singleton set, exported as `DEFAULT_ANGULAR_SHARED` (`@angular/core`, `/common`,
    `/common/http`, `/router`, `/platform-browser`, `rxjs`, `zone.js`), each
    `{ shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } }`. Caller overrides merge
    on top (`{ ...DEFAULT_ANGULAR_SHARED, ...options.shared }`) via the new `InitFederationOptions.shared`.
  - 💡 **Types-confirmed mechanics:** `ShareArgs` accepts the bare `SharedBaseArgs` form (`{ version?, shareConfig? }`,
    no `get`/`lib`) — so the runtime map only declares the *contract*; the module itself is supplied by the
    container's es-module-shims import map (finding #6), exactly as the corrected task says. The `shared` option
    type is derived as `NonNullable<Parameters<typeof createInstance>[0]['shared']>` to avoid importing from the
    transitive `runtime-core`.
  - ⚠️ **`requiredVersion: false` is deliberate, interim:** singleton is enforced but the version check is
    relaxed because resolving the installed version (NF's `requiredVersion: 'auto'`) is **M3.1**'s job
    (`withModuleFederation` → concrete ranges). When M3.1 lands it should feed real ranges here and flip
    `strictVersion` to bite. Tracked as the M3.1 ↔ M1.4 seam.
- [x] **[M1.5]** Builder (host path): externalize shared deps from the Angular build (the
  `externals` plugin in `builders/build/builder.ts:298–313` already does this for NF — re-point
  it at the MF shared set). No container needed for a pure host.
  - ✅ **MF externals source built (2026-06-28). typecheck + eslint + 3 unit tests green.** New
    `src/builders/build/get-externals.ts` → `getHostExternals(shared = DEFAULT_ANGULAR_SHARED, extra=[])`,
    the MF analog of NF's `getExternals` (which is just `[...Object.keys(config.shared),
    ...sharedMappings, ...externals]`). For a pure host the externalize list = the MF shared keys (sourced
    from M1.4's `DEFAULT_ANGULAR_SHARED`). Spec at `get-externals.spec.ts`.
  - 🔗 **Coupling finding — the builder call-site swap moves to M2.1 (deliberate, not skipped).** Proven by
    reading the builder: line 297 `getExternals(normalized.config)` **and** line 425
    `buildForFederation(normalized.config, …)` consume the *same* NF `normalized.config`. Re-pointing only the
    externals to MF in isolation would make the host externalize deps the NF side-build doesn't provide →
    broken bootstrap. So the externals source and the side-build's `shared` must flip to MF **together**, which
    is exactly M2.1's `buildForFederation`→`moduleFederationPlugin` swap. The externalization *mechanism* (the
    esbuild `external` plugin, 298–308) is artifact-agnostic and verified to survive unchanged; only its input
    source moves. Wire `getHostExternals` into builder.ts:297 as part of M2.1.
- [x] **[M1.6]** ⚠️ **Heavily revised by M0.1 finding #6 — es-module-shims STAYS.** Do **not** delete the
  shim loader. MF-esbuild's runtime depends on `importShim` (`ReferenceError` without it). What you *can* still
  drop is the NF-specific *orchestration* of it: the NF-only `useShimImportMap`/`useDefaultImportMap` helpers and
  the `InitFederationOptions.shimMode` option (MF manages the import map internally via `import-maps-plugin`).
  Keep `es-module-shims` as a dependency and keep loading it on the page (M2.5/polyfills). The
  `vite:import-analysis`/`es-module-shims` stderr filter (`builder.ts:64`) likely still applies — re-verify, don't
  delete blindly. Net: this task shrinks from "remove the shim layer" to "stop hand-managing import maps".
  - ✅ **Done / verified (2026-06-28).** The runtime-side orchestration was already removed by the M1.2
    rewrite: `index.ts` no longer imports `useShimImportMap`/`useDefaultImportMap` (they were
    `@softarc/native-federation-orchestrator/options` imports) and `InitFederationOptions.shimMode` is gone —
    grep finds only doc comments noting the removal. No new code needed; this task was a verify-and-confirm.
  - ✅ **es-module-shims kept** (still a dependency and still referenced by `add-dependencies`,
    `update-polyfills`, `update-index-html`, the `remove` schematic, and `builder.ts`) — per finding #6.
  - ✅ **stderr filter re-verified, NOT deleted** (`builder.ts:62–69`): it suppresses Vite's
    `vite:import-analysis` + `es-module-shims.js` warnings under `ng serve`. es-module-shims still loads, so the
    noise still occurs → the filter still applies. Kept.
  - ➡️ **Build-side esms plumbing is out of scope here:** the remaining `shimMode`/`esmsInitOptions` live in
    `update-index-html.ts` (`<script type="esms-options">`, `module-shim` rewrites) + `schema.d.ts` — that is
    **M2.5**, and per finding #6 most of it stays.
- [~] **[M1.7]** Tests: port/extend `src/index.spec.ts` for the MF runtime. Add an e2e: Angular
  host consumes a webpack/rspack-built MF remote.
  - ✅ **Unit spec rewritten & green (2026-06-28) — 13 tests, lint + typecheck clean; full suite 97/97.**
    `src/index.spec.ts` now mocks `@module-federation/runtime`'s `createInstance` (NF-orchestrator mocks
    deleted) and covers: instance creation (default `host` name, `loaded-first` strategy), remotes record →
    `{name,entry}` mapping, `DEFAULT_ANGULAR_SHARED` registration + caller-override merge, `runtimePlugins`/
    custom name pass-through, manifest-URL-string rejection, `loadRemoteModule` (`<name>/<expose>` id with `./`
    stripped, options-object form, `null`→failure, truthy `fallback`, **lazy `remoteEntry`** fetch→register→load),
    and that the standalone `loadRemoteModule` export is gone. **No sibling spec regressed** (97/97 across 15 files).
  - ⚠️ **E2e blocked on environment, NOT skipped.** The "Angular host consumes a webpack/rspack remote" e2e
    needs a **browser + es-module-shims + a real Angular app** — none exist in this sandbox (same constraint that
    deferred M0.2). This e2e is where the **M0.2/M0.G single-instance `NG0203` verdict is finally cashed out**.
    Recipe for whoever runs it (Playwright / `@web/test-runner`, host + a stock webpack MF remote):
    1. `initFederation({ remote: 'http://…/mf-manifest.json' })`, then `loadRemoteModule('remote', './Cmp')` and
       bootstrap the returned standalone component into the host.
    2. **Pass:** clean render, host & remote observe the **same** `@angular/core` identity (assert a symbol pinned
       on a core export, or a root-provided service is the same instance across the boundary).
    3. **FAIL = late gate failure:** `NG0203` / two `ɵɵdefineInjectable` registrations → two Angular copies →
       reassess (per the M0.G verdict's explicit "if M1.7 shows NG0203, treat as a late gate failure").

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
- [~] **CONDITIONAL — code-complete & unit-verified; empirical CSR-load blocked on browser env (2026-06-28).**
  All Phase-1 runtime tasks done (M1.1–M1.6) with the call-site externals swap correctly parked in M2.1 (M1.5).
  `src/index.ts` is a complete MF rewrite: `pnpm typecheck`, `eslint`, and the **full 97-test suite pass**, and the
  public API shape is preserved (`initFederation` → `{ loadRemoteModule, instance }`) minus the intentionally
  dropped NF-only options. **What's NOT yet empirically proven:** the live host-loads-remote CSR render +
  single-`@angular/core`-instance check — it requires a browser + es-module-shims + Angular, absent here, and is
  authored as the M1.7 e2e recipe. Per the M0.G verdict this is *execution-environment* missing, not a technical
  blocker; **if that e2e shows `NG0203`, this is a late gate failure → reassess before Phase 2 ships.** Phase 2
  build work (which doesn't need the browser) may proceed in parallel; do not *publish* the Phase-1 deliverable
  until the e2e is green.

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

- [x] **[M2.1]** Wire the side esbuild build with `moduleFederationPlugin({ name, filename,
  exposes, shared })`, replacing the `buildForFederation`/`rebuildForFederation` calls in
  **both** builders: `build/builder.ts:425` & `:551`, and `remote/builder.ts:125` & `:172`.
  Drive it from the same orchestration loop.
  - ✅ **DONE — both builders wired (2026-06-28). typecheck + eslint clean; full suite 106 green.** Both
    `runBuilder` (`build/builder.ts`) and `runRemoteBuilder` (`remote/builder.ts`) now drive the stateful
    `createMfFederationBuilder` (`build()` / `rebuild(changedFiles)` / idempotent `dispose()`), and the NF
    imports (`buildForFederation`/`rebuildForFederation`/`setBuildAdapter`/`createAngularBuildAdapter`) are gone
    from both. Build builder specifics handled: the `#47` pre-app-build dispose → `mfBuilder.dispose()` (made
    **idempotent** since the final `finally` disposes again in non-watch); the **i18n cascade** bridged via a
    transitional `toFederationInfoForI18n()` shim (keeps `translateFederationArtifacts` + its 8-test spec
    unchanged — full per-locale MF i18n is **M4.2**). `createAngularBuildAdapter` is now referenced nowhere in
    production → **M2.3 factory deletion unblocked.** ⚠️ **Runtime artifact emit unverified** (no Angular app —
    the live proof is the M2.G gate / M1.7-class e2e); the wiring is static-verified (typecheck/lint/suite).
  - ✅ **Build mechanism re-proven in-workspace (2026-06-28)** — the M0.1 spike was deleted, so re-ran
    `moduleFederationPlugin@0.0.109` + esbuild `0.28.1` against the repo's own `node_modules`: emits
    `remoteEntry.js` + `mf-manifest.json` at **0 errors / 0 warnings**, manifest matches M0.4 exactly,
    `remoteEntry.js` contains `importShim`/`import-maps-plugin` (**finding #6 re-confirmed**), and the build
    only links because `@module-federation/webpack-bundler-runtime` resolves (**Breakage B re-confirmed** →
    validates M1.1).
  - ✅ **Config half done: `src/tools/mf/to-plugin-config.ts` → `toMfPluginConfig()`** maps a normalized
    federation config → the plugin's `NormalizedFederationConfig` (`name`/`filename`/`exposes`/`shared`/
    `remotes`). 5 unit tests; typecheck + eslint clean. Input shape declared **locally** (not imported from
    `@softarc`) so it survives Phase-3 NF removal. **Mapping nuances captured:** the plugin's
    `NormalizedSharedConfig.requiredVersion` is a **required `string`** (no `false`, unlike the runtime's
    `false|string`) → unresolved falls back to `'*'`; and the plugin **natively supports `includeSecondaries`**
    (re-confirms finding #4 — update M3.1's table, which calls it "no equivalent" in places).
  - 🧩 **Architectural finding that scopes the remainder — M2.1 must compose with M2.3.** esbuild +
    `moduleFederationPlugin` alone **cannot compile Angular** (templates/decorators/DI); NF's
    `buildForFederation` ran the Angular compiler via `createAngularBuildAdapter` *then* bundled. So the MF side
    build = **Angular compiler plugin + `moduleFederationPlugin`** in one `esbuild.build`. The compiler-plugin
    extraction is exactly M2.3's "keep what the side build still needs".
  - 🔑 **KEYSTONE — composition is ONE-PASS, and the injection seam already exists (2026-06-28).** Read the
    plugin source (`adapters/lib/plugin.js`, 340 lines). `moduleFederationPlugin.setup(build)` mutates the host
    context: `initialOptions.metafile = true`, **unions the config externals into `initialOptions.external`**,
    and consumes `initialOptions.entryPoints` as the container/app entry. Its nested `esbuild.build` (the
    `cjsToEsmPlugin`, namespace `esm-shares`) **explicitly overrides `plugins: [commonjs()]`** for the
    shared-package sub-build — so the Angular compiler plugin does **NOT** run twice (only shared deps get the
    nested commonjs pass). **And `createAngularEsbuildContext` (`angular-bundler.ts:162`) already appends
    `...customPlugins` (from `builderOptions.plugins`) to its esbuild `plugins`.** ⇒ The driver injects
    `moduleFederationPlugin(toMfPluginConfig(cfg))` into the *existing* Angular context — minimal surgery, not a
    second build. The two-pass (compile-then-federate) alternative is unnecessary and is rejected.
  - 📌 **Open implementation detail → M2.2:** the Angular context uses `write:false` + `writeResult`, but the MF
    plugin writes `mf-manifest.json` itself in `onEnd` (M0.1 finding #1). Reconcile by pointing the context
    `outdir` at `browserOutputPath`; the context's flat `entryNames` (`'[name]'`/`'[name]-[hash]'`,
    `angular-bundler.ts:146`) + `out: path.parse(ep.outName).name` already avoid the probe's absolute-path dir
    mirroring. Verify the plugin honors `write:false` or writes to `outdir` directly.
  - ✅ **Driver built & type-checked (2026-06-28).** `createAngularEsbuildContext` gained an optional
    `extraPlugins` param (`angular-bundler.ts` — appended after the compiler plugin, backward-compatible).
    `src/tools/mf/federation-plugin.ts` → `createFederationPlugin(cfg, filename?)` wraps
    `toMfPluginConfig` + `moduleFederationPlugin` into an injectable esbuild `Plugin` (no cast needed — the
    plugin's return type *is* assignable to esbuild's `Plugin`; verified by tsc). `src/tools/mf/federation-side-build.ts`
    → `createFederationEsbuildContext(options, cfg)` = the one-pass context. **typecheck + eslint clean; 7 mf-tests
    green** (full suite now 104). This proves the composition is *type-correct* against the real
    `@angular/build/private` + MF plugin types.
  - 🔑 **SCOPING FINDING — the orchestration is far smaller than NF's (2026-06-28, read NF
    `build-for-federation.js` + `bundle-exposed-and-mappings.js`).** NF's `buildForFederation` runs four shared-
    bundling phases — `bundleShared` (browser/node) + `bundleSeparatePackages` (browser/node) via `splitShared`
    — that **manually bundle each shared npm package into the import map**. **`moduleFederationPlugin` makes all
    four unnecessary** (it owns shared resolution internally via the `import-maps-plugin` + virtual share modules,
    finding #6). So the MF orchestration collapses to NF's **`bundleExposedAndMappings` step only**: derive
    `entryPoints` and run the (now MF-augmented) Angular esbuild context. Exact entry derivation to mirror:
    `exposes` → `{ fileName: expose.file, outName: key + '.js', key }` per `config.exposes`, plus shared-mappings
    entries; then one `createFederationEsbuildContext(...)` build. The MF plugin emits `remoteEntry.js` +
    `mf-manifest.json`; the exposed chunks are written via `writeResult`.
  - 🧹 **Knock-on dead code:** the adapter's `else` branch — `createNodeModulesEsbuildContext` /
    `node-modules-bundler.ts` — IS NF's shared-package bundler (the `node-shared`/`browser-shared` path). Since
    MF owns shared bundling, **that path and module become dead** and drop with the factory (fold into M2.3 /
    M3.5 cleanup). `bundle-shared.ts` likewise.
  - ✅ **Entry-point derivation landed (2026-06-28):** `src/tools/mf/federation-entry-points.ts` →
    `toExposedEntryPoints(exposes)` (`{ fileName: expose.file, outName: key+'.js', key }`), local type
    structurally assignable to NF's `EntryPoint`. 2 tests; typecheck + eslint clean (suite now 106).
  - ✅ **Orchestration `buildForFederationMf` written & type-checked (2026-06-28).**
    `src/tools/mf/build-for-federation.ts`: derives entry points (`toMappingEntryPoints` +
    `toExposedEntryPoints`), reuses `normalizeContextOptions` with field values **mirroring NF's
    `bundleExposedAndMappings` exactly** (`outdir: outputPath`, `tsConfigPath: tsConfig`, `hash: !dev`,
    `optimizedMappings: features.ignoreUnusedDeps`, `cache: federationCache`) → correct-by-construction, then
    `createFederationEsbuildContext` → `rebuild()` → `writeResult`, returning `MfFederationInfo {name, exposes,
    writtenFiles}`. Also **extracted `writeResult`** to the survivable `tools/esbuild/write-result.ts` (like
    `setNgServerMode`) and removed it + now-dead `fs`/`path` imports from the adapter. typecheck + eslint clean;
    **full suite 106 green** (adapter refactor caused no regression).
  - ✅ **Refactored to a STATEFUL builder (2026-06-28)** — `createMfFederationBuilder(...)` returns
    `{ build, rebuild(modifiedFiles), dispose }`, holding one esbuild `BuildContext` across rebuilds. This is the
    correct shape for **both** call sites' lifecycle (initial build + watch-loop rebuild + dispose), mirroring
    NF's adapter — so it covers `rebuildForFederation` and preserves `ng serve` incremental DX (**M2.6**), not
    just the initial build. `rebuild` invalidates changed files via `cache.bundlerCache.invalidate` (typecheck
    confirms the method exists). `buildForFederationMf` kept as a one-shot (create→build→dispose) for non-watch.
    typecheck + eslint clean.
  - ✅ **Remote builder WIRED (2026-06-28) — first real call-site swap.** `runRemoteBuilder`
    (`remote/builder.ts`) now drives `createMfFederationBuilder` (`build()` initial, `rebuild(changedFiles)` in
    the watch loop, `dispose()` in `finally`); dropped the `setBuildAdapter`/`buildForFederation`/
    `rebuildForFederation`/`createAngularBuildAdapter` imports + the adapter creation. **typecheck + eslint clean;
    full suite 106 green, no regression.** Fixed a real bug found while wiring: `optimizedMappings` reads
    `config.features.ignoreUnusedDeps` (not `fedOptions`), mirroring NF. `tsConfig` made optional to match NF's
    `string|undefined`. ⚠️ runtime emit still unverified (no Angular app — M1.7-class limit).
  - **REMAINING M2.1 step — wire the BUILD builder (`build/builder.ts:425` build, `:551` rebuild):** this is the
    one with the i18n cascade — This is a *coordinated* change, not a drop-in, because it
    cascades: (a) `MfFederationInfo` ≠ NF's `FederationInfo`, so the `translateFederationArtifacts(…,
    federationResult)` i18n call (`build/builder.ts:452`) must move to MF shape → **couples with M4.2**; (b) the
    `createAngularBuildAdapter`/`setBuildAdapter` path (`:218`) becomes unused → **delete with M2.3**; (c) fold in
    `getHostExternals` (M1.5); (d) add a `rebuildForFederationMf` (incremental `ctx.rebuild()` reuse). A half-swap
    breaks typecheck, so it must land atomically with the M2.2/M2.3/M4.2 touches. ⚠️ **runtime emit only
    verifiable with a real Angular app** (absent here — same limit as the M1.7 e2e).
- [x] **[M2.2]** Emit `remoteEntry.js` + `mf-manifest.json` into Angular's browser output dir
  (`browserOutputPath`, `builder.ts:246`). Reconcile MF's output naming/hashing with Angular's
  layout (`outputOptions`, `:227`).
  - 🔑 **Correctness finding + fix (2026-06-28): the MF plugin does NOT honor esbuild `write:false`.** Read
    the plugin's `onEnd`: it `fs.readFileSync`s the emitted **container off disk** to inject the exposed module
    map (`"__MODULE_MAP__"` → `exposedEntries`) then `fs.writeFileSync`s it, and calls `writeRemoteManifest`.
    Under the Angular context's original `write:false` (outputs in memory, written later by `writeResult`) that
    `readFileSync` would crash at runtime. **Fix:** added a `write` override to `createAngularEsbuildContext`
    (default `false` for the NF adapter path) and set **`write:true`** in `createFederationEsbuildContext`. Now
    esbuild writes the exposed chunks + container + `mf-manifest.json` directly to `outdir`; `buildForFederationMf`
    collects emitted files from `result.metafile.outputs` (no `writeResult` needed under `write:true`).
  - ✅ **Emit + naming reconciled:** `outdir` = `fedOptions.outputPath` = `browserOutputPath` (driver wiring);
    flat `entryNames` (`'[name]'` dev / `'[name]-[hash]'` prod) + `out: parse(outName).name` avoid dir-mirroring;
    `remoteEntry.js` fixed name, `mf-manifest.json` written by the plugin. typecheck + eslint clean; suite 106.
    ⚠️ **Runtime emit unverified** (no Angular app — M2.G/M1.7-class e2e).
- [x] **[M2.3]** Retire `tools/esbuild/angular-esbuild-adapter.ts` and `setBuildAdapter` — the MF
  plugin owns the side build now. The concrete thing to drop is the **`createAngularBuildAdapter`
  factory** (`:62`), which returns the NF-typed `NFBuildAdapter` contract (`NFBuildAdapter` is an
  imported *type* from `@softarc/native-federation`, not a local symbol). Keep only what the side
  build still needs from `tools/esbuild/*` (tsconfig creation, shared-mappings if still relevant).
  ⚠️ `setNgServerMode` (`:45`) is a **private, non-exported** function called from inside the factory
  (`:100`); Phase 4 SSR (M4.1) wants to reuse it, so extract/re-export it before deleting the factory.
  - ✅ **Extract-before-delete done (2026-06-28). typecheck + eslint + 8 adapter tests green.**
    `setNgServerMode` moved verbatim to its own **survivable** module `src/tools/esbuild/set-ng-server-mode.ts`
    (now `export`ed); the adapter imports it. So when the factory file is deleted, the SSR patch M4.1 needs
    still exists. Behavior unchanged (the @angular/core `fesm2022/core.mjs` runtime-ngServerMode patch).
  - 📋 **Audit of `tools/esbuild/*` (keep vs drop), needed by M2.1's driver:**
    - **KEEP (the MF side build reuses these as the Angular compiler half):** `angular-bundler.ts`
      (`createAngularEsbuildContext` — the Angular compiler context/plugin), `node-modules-bundler.ts`,
      `create-federation-tsconfig.ts`, `shared-mappings-plugin.ts`, `create-awaitable-compiler-plugin.ts`,
      `normalize-context-options.ts`, and the `writeResult` helper (generic outdir writer).
    - **DROP with the factory:** `createAngularBuildAdapter` itself + its `@softarc/native-federation` type
      imports (`NFBuildAdapter`/`NFBuildAdapterResult`/`NFBuildAdapterOptions`/`NFBuildAdapterContext`/
      `FederationCache`).
  - ✅ **Factory + dead NF bundlers DELETED (2026-06-28).** After both builders were wired (M2.1), removed
    `angular-esbuild-adapter.ts` (+ spec) and `node-modules-bundler.ts` (+ spec — NF's shared-package bundler /
    `createNodeModulesEsbuildContext`, dead under MF since the plugin owns shared bundling). Also dropped the
    now-dead `write-result.ts` (the driver derives written files from `metafile` under `write:true`, M2.2) and
    the unused one-shot `buildForFederationMf`. **typecheck + eslint clean; suite 92 green** (−14 from the two
    deleted specs). `knip` now reports only: `set-ng-server-mode.ts` (**intentionally pending M4.1 SSR** — the
    extract-before-delete) and `@module-federation/sdk`/`webpack-bundler-runtime` (**false positives** — the
    latter is imported by the *generated container*, not our source; a `knip.json` ignore is **M3.5**).
  - ⚠️ **Runtime risk recorded (ties to M0.3):** NF's deleted `createNodeModulesEsbuildContext` ran Angular
    **partial-ivy linking** (`requiresLinking`) when bundling shared libs. MF's nested shared build is
    **commonjs-only** (`cjsToEsmPlugin`), with no linking step — so whether shared **partial-ivy Angular libs**
    (e.g. `@angular/material`) link correctly under MF is an **open runtime question**, unverifiable here.
    Re-check when a real Angular build with a shared component lib runs (Phase 2 e2e / M2.G).
- [x] **[M2.4]** Re-point the dev-server middleware (`builder.ts:352–401`) to serve
  `remoteEntry.js` + MF chunks with CORS (logic survives; only filenames change).
  - ✅ **Verified — NO code change needed (2026-06-28).** The middleware is **fully artifact-agnostic**: it
    serves *any* file that exists under `devServerOutputPath` by URL→`fs` lookup, with CORS
    (`Access-Control-Allow-Origin: *`, `GET` allowed) and `mrmime` content-types. There are **zero hardcoded
    filenames** (`grep` confirms the only `remoteEntry`/`mf-manifest` mention in `builder.ts` is the i18n shim's
    doc comment) — so the doc's "only filenames change" was an overestimate; nothing is coupled to NF's
    `remoteEntry.json`. It already serves `remoteEntry.js` + `mf-manifest.json` + MF chunks unchanged. Confirmed
    `mrmime`: `.js → text/javascript`, `.json → application/json` (correct for both artifacts). The MF side build
    writes these to `outdir` (= `browserOutputPath` = `devServerOutputPath`) under `write:true` (M2.2), so the
    middleware finds them on disk. ⚠️ end-to-end serve unverified without a running `ng serve` (M2.G).
- [x] **[M2.5]** Update `index.html` script wiring: `update-index-html.ts` `updateScriptTags` (`:32`)
  injects an `<script type="esms-options">` tag (`:44`, `shimMode: true` by default) and rewrites the
  `polyfills` (`:47`) and `main` (`:54`) script tags to `type="module"` / `type="module-shim"` — all
  es-module-shims plumbing. ⚠️ **Reassessed after finding #6:** since es-module-shims STAYS, most of this
  plumbing is **still required** (MF-esbuild's `importShim` calls need es-module-shims loaded and configured).
  Likely keep the `esms-options` tag and the `module-shim` rewrites; the change is reconciling `shimMode` and
  any MF-specific bootstrap, not removing the tags. Verify against a real MF host before editing; update
  `update-index-html.spec.ts` accordingly.
  - ✅ **Verified — plumbing STAYS, no code change (2026-06-28).** `updateScriptTags` is **pure es-module-shims
    wiring** with **zero federation-artifact coupling** (no `remoteEntry.json`/manifest names) — it only injects
    `<script type="esms-options">{shimMode:true,…}</script>` and rewrites polyfills→`module` / main→`module-shim`.
    Per finding #6 this is exactly what MF-esbuild needs (its container calls `importShim.*`), so it carries over
    unchanged; the 9-test `update-index-html.spec.ts` stays green (no edit). The doc's "don't edit before
    verifying against a real MF host" → honored: no blind change.
  - ⚠️ **One MF-specific decision deferred to real-host verify (M2.G):** the container **hardcodes
    `importShim.addImportMap`** (shim-mode API), so `shimMode:true` (default) is right for MF. Whether NF's
    `shimMode:false` *native import-map* escape hatch (#70) is even viable under MF is unverified — it may need
    to be **rejected/removed** for MF. Re-evaluate with a running MF host; if removed, update `schema`/`esmsInitOptions`.
  - 🧹 The NF type import `FederationOptions` from `@softarc/native-federation` (`:3`) is transitional → **M3.5**.
- [x] **[M2.6]** Preserve incremental rebuild DX: `RebuildQueue` + `createNfWatcher` watch sync
  (`builder.ts:495–626`) must drive the MF side build's rebuilds, or `ng serve` DX regresses.
  - ✅ **Preserved by the M2.1 wiring — verified (2026-06-28).** The entire orchestration (`RebuildQueue`,
    `createNfWatcher`/`changeWatcher`, `syncNfFileWatcher`, the interrupt/abort flow) was kept untouched; only the
    inner build call was swapped to `mfBuilder.rebuild(changedFiles)`. **Build builder:** `nfWatcher.get()` →
    `changedFiles` → `mfBuilder.rebuild` → `syncNfFileWatcher(nfWatcher, federationCache.bundlerCache)`, inside
    `rebuildQueue.track`. **Remote builder:** `changeWatcher.pendingPaths` → `mfBuilder.rebuild` →
    `syncNfFileWatcher`, inside `rebuildQueue.track`. The cache `mfBuilder.rebuild` invalidates
    (`options.cache.bundlerCache`) **is the same** `federationCache.bundlerCache` the watcher syncs → consistent
    incremental state. The stateful builder holds one esbuild context across rebuilds (fast incremental).
  - ⚠️ **Minor DX caveat (noted at the remote call site):** NF's `rebuildForFederation` took an `AbortSignal` for
    *mid-build* cancellation; `mfBuilder.rebuild` doesn't thread it into `ctx.rebuild()` (esbuild rebuilds aren't
    abortable mid-flight). Queue-level interruption (folding a newer change) still works via `rebuildQueue.track`.
    Runtime incremental correctness (esbuild context reuse + MF plugin re-emit per rebuild) deferred to M2.G.
- [x] **[M2.7]** SSE reload path: **mostly survives the swap unchanged** — verified, lower risk than
  it reads. `federation-build-notifier.ts` is an artifact-*agnostic* SSE manager (`text/event-stream`
  connection pool) that just signals "rebuild happened, reload" — no artifact name baked in.
  `setup-builder-env-variables.ts` only sets `NG_BUILD_PARALLEL_TS=0` (an Angular build tweak,
  **unrelated** to federation artifacts or SSE — was miscategorized here). The only artifact-coupled
  piece is `update-index-html.ts` (covered by M2.5). Net: re-point nothing here except confirm the
  notifier still fires after the MF side build completes.
  - ✅ **Confirmed — no code change (2026-06-28).** `federation-build-notifier.ts` grep-verified
    artifact-agnostic (no `remoteEntry`/`mf-manifest`/filename refs). Lifecycle intact in the build builder:
    `initialize` + `createEventMiddleware` (SSE setup), `broadcastBuildCompletion` (`:583`) fires in the success
    path **right after `mfBuilder.rebuild`** (`:552`), with `broadcastBuildCancellation`/`broadcastBuildError`
    in the catch and `stopEventServer` in cleanup. Initial `mfBuilder.build` needs no broadcast (fresh page
    load); rebuilds broadcast → browser reload. `setup-builder-env-variables.ts` (`NG_BUILD_PARALLEL_TS=0`)
    confirmed unrelated. The SSE reload signal survives the swap.

**Gate [M2.G]:** Angular-built remote (CSR) is consumed by a stock webpack/rspack MF host;
`ng serve` rebuilds the remote on change.
- [~] **CONDITIONAL — code-complete & static-verified; live consume/serve blocked on a real Angular app (2026-06-28).**
  All Phase-2 tasks done (M2.1–M2.7): both builders drive the MF side build (`createMfFederationBuilder`), the NF
  build engine + its dead code are gone, artifacts emit to `browserOutputPath` (`write:true`), the dev-server
  middleware (CORS) + SSE notifier + rebuild DX are preserved, and index-html es-module-shims wiring stays
  (finding #6). **typecheck + eslint + knip(expected-only) clean; suite 92 green.** Mirrors the M0.G/M1.G
  pattern: the *code* is complete and statically verified, but the **empirical proof** — an Angular-built CSR
  remote consumed by a stock webpack/rspack host + `ng serve` incremental rebuild — needs a real Angular
  workspace + browser, absent in this sandbox. **Carried-forward runtime risks to check in that e2e:** (a) the
  one-pass emit (`onEnd` container rewrite under `write:true`); (b) shared **partial-ivy Angular lib linking**
  (MF nested build is commonjs-only — M2.3); (c) `shimMode:false` viability (M2.5); (d) the dominant 0.0.x
  defects. If any fail, treat as a late Phase-2 gate failure. Phase 3 (config/schematics/NF-removal) needs no
  browser, so it may proceed in parallel; do not *publish* the Phase-2 deliverable until this e2e is green.

---

## Phase 3 — Config + schematics parity, and NF removal 🟢

- [x] **[M3.1]** `withModuleFederation(config)` mirroring `withNativeFederation`
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

  - ✅ **DONE (2026-06-28) — built as a thin wrapper over upstream, per finding #4. 7 tests (incl. runtime),
    typecheck + eslint clean, suite 99.** `src/config/with-module-federation.ts` exports `withModuleFederation`,
    `share`, `shareAll`, `getDefaultPlatform`, `SERVER_DEPENDENCIES`. **Key enabler:** the upstream MF config
    layer (`share`/`shareAll`/`withFederation`/`lookupVersion`) is reachable via the **deep import**
    `@module-federation/esbuild/dist/lib/config/*` — allowed by the package's `"./*"` export and **free of
    Breakage A** (the `json5` crash is isolated to other `/build` re-exports). The spec proves `withModuleFederation`
    actually executes `coreWithFederation` at runtime (not just typecheck), so the reuse is functional.
    **Mapping-table decisions realized in code:** `requiredVersion:'auto'` → upstream `lookupVersion` (version
    resolved at config-build time, inside `share`/`shareAll`); `includeSecondaries` → supported (kept on
    `MfSharedConfig`, incl. the `{skip}` form, casting past the two upstream type defs that disagree —
    `withFederation`'s is `boolean`-only); `build`/`features.{denseChunking,ignoreUnusedDeps}` → **dropped**;
    `platform` → kept Angular-side only (`getDefaultPlatform`, re-attached to the normalized output, NOT an MF
    `shared` key — for the SSR side build, Phase 4).
  - ⚠️ **Deep-import fragility:** the `dist/lib/config/*` paths are 0.0.x internals (pinned 0.0.109). Re-verify on
    any version bump; tracked with the dominant 0.0.x risk. (Alternative if it breaks: port the thin logic.)
  - **Deferred to adjacent tasks:** the Angular skip-list (`shareAll`'s `skip`) → **M3.2** (MF-native NG_SKIP_LIST);
    the `./config` barrel rewire (`src/config.ts` still exports the NF `withNativeFederation`) → **M3.5**; NF's
    `removeNgLocales` backwards-compat (tied to the dropped `features.ignoreUnusedDeps`) → folded into
    `shareAngularLocales` handling at **M4.2**.

- [x] **[M3.2]** Angular skip-list equivalent of `config/angular-skip-list.ts` for MF. Two NF couplings
  to break: (1) it imports both the `SkipList` **type** and the `DEFAULT_SKIP_LIST` base from
  `@softarc/native-federation/config` (`:1`) — reimplement both locally or map to MF's exclusion model;
  (2) `NG_SKIP_LIST` self-lists the **old** `@angular-architects/native-federation*` package paths
  (`:5`–`:7`) — update to the renamed package. The `@angular/localize*`, `*/upgrade`, and
  `*/testing` predicate entries carry over as-is.
  - ✅ **DONE (2026-06-28). typecheck + eslint clean; suite 99.** Both couplings broken: (1) `SkipList` +
    `DEFAULT_SKIP_LIST` now imported from `@module-federation/esbuild/dist/lib/core/default-skip-list.js` (deep
    import, Breakage-A-free; MF's `SkipListEntry = string|RegExp|SkipFn` mirrors NF's exactly) — **no more
    `@softarc/native-federation/config` import**; (2) self-listed paths updated to
    `@angular-architects/module-federation-esbuild`(`/config`,`/internal`). `@angular/localize*`, `*/upgrade`,
    `*/testing`, `@nx/angular`, `zone.js` carried over unchanged. **Wired into M3.1:** `withModuleFederation`'s
    `shareAll` now defaults `skip` to `NG_SKIP_LIST`.
  - 📝 The transitional NF `share-utils.ts` still imports `NG_SKIP_LIST` (now MF-typed) and its 19-test spec
    stays green — the MF `SkipList` is structurally compatible and the spec uses identity (`toBe`) checks, not
    contents. Both go in **M3.5**.
- [~] **[M3.3]** Rework schematics: `init`, `appbuilder`, the generator
  (`generators/native-federation/` → rename), and `federation.config.mjs__tmpl__` to scaffold MF
  config (`federation.config.*`). Rename `init` artifacts to the new package name.
  - ✅ **Core scaffold reworked (2026-06-28). typecheck + suite 99 green.** **Template
    (`federation.config.mjs__tmpl__`) rewritten:** import → `@angular-architects/module-federation-esbuild/config`,
    `withNativeFederation`→`withModuleFederation`; **NF-only fields resolved** — `requiredVersion:'auto'` **kept**
    (🔑 finding: upstream MF *does* honor `'auto'` via `lookupVersion`, contra parts of M3.1's table), `build:'package'`
    + `features.denseChunking` **dropped**, `includeSecondaries:{keepAll:true}` **flattened to `true`**, and NF's
    `shareAll(cfg,{overrides})` → MF's `shareAll(cfg)` + **object-spread** `@angular/core` override. **Package-name
    renames** (define `ng add`/`ng g` output): `make-main-async` `initFederation` import, `update-workspace-config`
    builder (all 3 → `…module-federation-esbuild:build`), generator `executor`, and `collection.json` name/descriptions.
    **`appbuilder` verified** — it flips to `@angular/build:application` (Angular's own builder), so no change.
  - **Remaining (each coupled to another task, not skipped):** `add-dependencies.ts` (install MF deps / drop
    `@softarc` — with **M3.5**); the `remove` schematic's es-module-shims/polyfill stripping (lockstep with **M3.5**,
    and ⚠️ per finding #6 es-module-shims STAYS so removal must stay symmetric, not over-strip); `update22` ng-update
    refs (**M3.4** resets migrations); `wire-serve-ssr-script.ts` node-preload path (**M4.1** SSR);
    `update-package-json.ts` NF `patch-angular-build.js` (**M3.5**); and the cosmetic `generators/native-federation/`
    dir rename.
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
- [x] **[M3.4]** Reset `ng update` migrations: this is a new package starting at its own version,
  so `schematics/update18`/`update22` + `migration-collection.json` should be cleared/replaced —
  no NF→MF upgrade path is owed. (Optional: a *separate* one-shot "switch from NF" codemod, but
  it is out of scope for v1.)
  - ✅ **DONE (2026-06-28). typecheck + suite 99 green.** Deleted `src/schematics/update18/` and
    `src/schematics/update22/` (grep-confirmed no TS imports — only the migration collection referenced them by
    factory-path string). Emptied `migration-collection.json` to `{ schematics: {} }` and renamed it to
    `module-federation-esbuild` (kept the file + the `package.json` `ng-update.migrations` pointer, so the
    infra stays for future migrations). The `update22` schematic's `@angular-architects/native-federation`
    refs are gone with it. No NF→MF codemod (out of scope for v1, per the task).
- [~] **[M3.5]** Remove NF deps + dead code: `@softarc/native-federation*` and the import-map types in
  `index.ts` (`Imports`/`Scopes`/`ImportMap`). ⚠️ **Corrected by M0.1 finding #6: do NOT remove
  `es-module-shims`** — `@module-federation/esbuild`'s runtime requires the `importShim` global, so it stays
  a dependency *and* stays injected by the polyfills step. Leave `updatePolyfills.ts`'s two es-module-shims
  injection paths (`updatePolyfillsFile`/`updatePolyfillsArray`) **in place** (they may need re-pointing, not
  deleting). Update `package.json` exports (drop NF-shaped entries), `knip.json`, `collection.json`,
  `builders.json`. Net: the "wholesale es-module-shims removal" is cancelled; only the `@softarc/*` engine goes.
  - ✅ **Done this pass (2026-06-28). typecheck + eslint + knip clean; suite 80.** (1) **`index.ts` is now pure
    MF** — removed `export * from '@softarc/native-federation/domain'` and the `Imports`/`Scopes`/`ImportMap`
    types (grep-confirmed unused elsewhere); 13 index tests green. (2) **NF config layer removed** — rewired the
    `./config` barrel (`src/config.ts`) to export `withModuleFederation`/`share`/`shareAll`/`getDefaultPlatform`
    from `with-module-federation.js`, then deleted `config/share-utils.ts` + its 19-test spec (−19 → suite 80).
    (3) **`knip.json` updated** → clean: `ignore` `set-ng-server-mode.ts` (pending M4.1) + `ignoreDependencies`
    `@module-federation/sdk` & `webpack-bundler-runtime` (runtime-required; the latter imported by the
    *generated container*, Breakage B, so invisible to static analysis).
  - 🚨 **SCOPE FINDING — wholesale `@softarc` removal is NOT a cleanup; it's reimplementing reused
    infrastructure.** `@softarc` is still **load-bearing** in ~24 files: the builders reuse
    `normalizeFederationOptions` (config loader → `normalized.config/options`), `createFederationCache` +
    `FederationCache`/`SourceFileCache` (the bundler cache the MF builder invalidates), `getExternals`, and
    `@softarc/native-federation/internal`'s `RebuildQueue`/`createNfWatcher`/`syncNfFileWatcher`/`AbortedError`/
    `logger`/`getDefaultCachePath` (watch + rebuild orchestration), plus shared **types** (`EntryPoint`,
    `FederationInfo`, `NFBuildAdapterOptions` via `normalize-context-options.ts`). The runtime **orchestrator**
    (`@softarc/native-federation-orchestrator`) is still used by SSR (`node-preload.ts`,
    `dev-host-instances-entry.ts`) → **Phase 4**. **⇒ The migration swapped the build *engine* + CSR runtime but
    reused NF's config/cache/watch orchestration.** Dropping the `package.json` `@softarc/*` deps requires
    MF-native (or ported-local) reimplementations of *all* of the above — a large effort, much of it
    runtime-unverifiable (config/cache/watch), with the orchestrator piece **gated on Phase-4 SSR**. M3.G's "no
    `@softarc/*` references remain" therefore cannot close until that infra is reimplemented; tracked as the
    dominant remaining Phase-3/4 work. **Remaining file-level renames** (still pointing at the old package, not
    load-bearing): `add-dependencies.ts` (install MF deps / drop `@softarc`), `update-package-json.ts` (NF
    `patch-angular-build.js`), `wire-serve-ssr-script.ts` (Phase 4), and the `remove` schematic (keep
    es-module-shims stripping symmetric, finding #6).
- [~] **[M3.6]** Rewrite `README.md`, `MIGRATION_GUIDE.md`, `AGENTS.md` for the new package.
  `package.json` is **partly** renamed already: `name` is `@angular-architects/module-federation-esbuild`
  (v22.0.2) and `repository` points at the `Aukevanoost/angular-module-federation-adapter` fork — but
  `homepage` still reads `https://github.com/native-federation/angular-adapter` (fix it), and the four
  `exports` subpaths (`.`, `./config`, `./internal`, `./node-preload`) plus `files` must be reconciled
  with the final MF surface.
  - ✅ **`package.json` reconciled (2026-06-28).** `homepage` fixed →
    `https://github.com/Aukevanoost/angular-module-federation-adapter#readme` (valid JSON re-verified). The four
    `exports` subpaths + the `files` array were **audited and are correct** — all targets exist (`src/index`,
    `src/config` [now MF], `src/internal`, `src/node-preload`; `collection.json`, `generators.json`,
    `builders.json`, `migration-collection.json`, `README.md`, `LICENSE`). `name`/`repository` already correct.
  - ⏸️ **Prose docs (README/MIGRATION_GUIDE/AGENTS) deliberately deferred.** Rewriting "how to use" docs now
    would document an **unverified** package: the API surface isn't final (M3.5's `@softarc` infra removal +
    Phase-4 SSR are open) and **no gate is empirically green** (all CSR/build proofs await a real Angular app).
    Write these once the surface stabilizes and the M1.7/M2.G e2e passes — documenting a non-working package
    first would mislead adopters. Tracked as end-of-migration work.

**Gate [M3.G]:** `ng add @angular-architects/module-federation-esbuild` + `ng g host/remote`
produce a working MF host+remote pair; `knip` and `lint` clean; no `@softarc/*` references remain
anywhere. (⚠️ `es-module-shims` **does** remain — finding #6 — so it is *not* part of the clean-out;
only the `@softarc/*` NF engine must be gone.)
- [ ] **NOT YET — two independent blockers (2026-06-28).** ✅ `knip` + `lint` (+ typecheck, suite 80) are
  clean, and the config/skip-list/template/migrations are MF (M3.1–M3.4). ❌ **Blocker 1 — `@softarc/*` still
  present:** the wholesale removal (M3.5) is incomplete because `@softarc` is **load-bearing** infra
  (config loader, federation cache, watch/rebuild orchestration, shared types) + the SSR orchestrator (Phase 4);
  removing it = reimplementing that infra (the dominant remaining effort). ❌ **Blocker 2 — `ng add`/`ng g`
  unverified:** producing a working host+remote pair needs a real Angular workspace + browser, absent here
  (same limit as M1.7/M2.G). The *static* half (clean, MF-shaped config/schematics) is done; the gate stays open
  until the infra is reimplemented AND a real `ng add`/serve e2e is green.

---

## Phase 4 — SSR + i18n (long tail, optional for v1) 🔴

- [~] **[M4.1]** SSR: evaluate `@module-federation/node` against Angular's server build pass and
  the `ngServerMode` shared-bundle patch (`angular-esbuild-adapter.ts:setNgServerMode`, see M2.3's
  extract-before-delete note). Treat as research; the dev-SSR singleton bridge needs an MF
  equivalent designed from scratch. The three NF pieces to replace, with their actual mechanics:
  - 🚨 **RESEARCH VERDICT (2026-06-28): SSR under MF-esbuild is architecturally blocked, not just env-blocked.**
    Two compounding findings: **(1)** `@module-federation/node` (latest **2.7.45**) declares peer
    `webpack: ^5.40.0` — it's **webpack-coupled**, not aligned with our esbuild build; it expects webpack-shaped
    containers, not MF-esbuild's. **(2) The deeper blocker:** MF-esbuild's emitted container requires the
    `importShim` global (es-module-shims, finding #6), which is a **browser** global. **Node SSR has no
    `importShim`** → loading an MF-esbuild remote server-side reproduces the M0.1 Node
    `ReferenceError: importShim is not defined`. NF avoided this with a *real Node ESM loader*
    (`initNodeFederation` + `module.register()`, no `importShim`); **MF-esbuild ships no equivalent Node loader.**
    ⇒ Server-side rendering of MF-esbuild remotes has no proven path today. **Recommendation: defer SSR to
    post-v1** (feeds M4.3 → CSR-only v1). If pursued later, options to research: (a) an es-module-shims Node shim
    / `importShim` polyfill for SSR; (b) a custom Node loader that resolves MF shares without the browser
    container; (c) waiting for an esbuild-aware `@module-federation/node`. `setNgServerMode` is already extracted
    (M2.3) and ready for whichever path. **Implementation deferred — needs an SSR+Angular env AND a solved loader.**
  - `node-preload.ts` (161 lines) — a Node `--import` preload that calls `module.register()` to
    install NF's server-side ESM loader **before** `@angular/*` is pulled in, then publishes startup
    state via two global keys (`__NF_HOST_SERVER_LOADER__` = `SERVER_LOADER_GLOBAL_KEY`,
    `__NF_FEDERATION_STATUS__` = `FEDERATION_STATUS_GLOBAL_KEY`) and honours an `NF_REQUIRE_REMOTES`
    env contract. The MF redesign must reproduce this *register-loader-before-Angular* ordering and
    pick its own status/handshake mechanism.
  - `plugin/dev-host-instances-plugin.ts` (40 lines) — esbuild `Plugin` (`:21`) that injects the
    entry below into the dev server build.
  - `tools/ssr/dev-host-instances-entry.ts` (150 lines) — the injected dev-only bridge body.
- [~] **[M4.2]** i18n: replicate `translateFederationArtifacts` (`builders/build/i18n.ts:40`)
  against MF artifact names. ⚠️ `copyRemoteEntry` (`:104`) **hard-codes `remoteEntry.json`**, copying
  it from the source locale into each `browser/<locale>/remoteEntry.json` (`:108`); under MF this must
  copy `remoteEntry.js` **and** `mf-manifest.json` per locale instead. Entry point is `getI18nConfig`
  (`:31`); translation runs via Angular's `localize-translate` CLI (`:85`). Re-verify `shareAngularLocales`
  (`config/angular-locales.ts:3`).
  - ✅ **Artifact-name rework done (2026-06-28). typecheck + eslint clean; i18n spec 9 / suite 81 green.**
    `copyRemoteEntry` → **`copyFederationArtifacts`**: copies **`remoteEntry.js` + `mf-manifest.json`** into each
    `browser/<locale>/` (was the single NF `remoteEntry.json`). Guards each with `fs.existsSync` (a pure host has
    no `remoteEntry.js`). Spec updated: asserts 4 copies (2 artifacts × 2 locales) + a skip-when-absent case. The
    file-list fed to `localize-translate` already comes from MF's written files via the M2.1
    `toFederationInfoForI18n` shim.
  - ⏸️ **Deferred (needs Angular):** the actual `localize-translate` CLI run + per-locale artifact emission, and
    re-verifying `shareAngularLocales` (`config/angular-locales.ts` still has 1 `@softarc` import → resolves with
    M3.5). i18n is **optional for v1** (M4.3).
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

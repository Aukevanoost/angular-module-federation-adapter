# Plan: An Angular Adapter for Module Federation v2

> Status: design proposal / feasibility plan
> Target: a new repository, mirroring the structure of `@angular-architects/native-federation`
> Date: 2026-06-20

## 0. TL;DR

Build `@<scope>/module-federation` — an Angular adapter that lets Angular apps
**produce and consume Module Federation v2 remotes** while staying on Angular's
official esbuild `ApplicationBuilder`, exactly the way this `native-federation`
adapter stays on it.

The federation engine already exists and is bundler-agnostic enough:

- **Build side:** `@module-federation/esbuild` — a real esbuild plugin that emits
  an MF `remoteEntry.js` container + `mf-manifest.json`, and routes shared
  imports through the MF runtime via virtual modules (`__FEDERATION__.__INSTANCES__`,
  `container.loadShare()`). **No import maps** — true MF shareScope semantics.
- **Runtime side:** `@module-federation/runtime` — pure JS, framework- and
  bundler-agnostic (`createInstance`, `registerRemotes`, `loadRemote`, `loadShare`).

So **the federation invention is done.** What does not exist — and what this
project is — is the **Angular adapter layer**: the glue that makes that esbuild
plugin cooperate with Angular's wrapped, multi-pass builder and with Angular's
runtime constraints (single-instance DI, zone, i18n, SSR).

This is the *same category of work* the native-federation adapter already does.
It is feasible. The dominant risk is **maturity of `@module-federation/esbuild`**,
not any architectural impossibility.

---

## 1. Why this is the "genuinely feasible" option

Three options were on the table; this is the only one that is both buildable and
worth building:

| Option | Verdict | Why |
| --- | --- | --- |
| Full MF *build-plugin* DX via webpack/rspack graph rewriting | ❌ | Requires replacing Angular's bundler. Not an adapter — a fork of the build system. |
| Hand-rolled MF protocol on raw esbuild + import maps | ⚠️ | Reinvents `@module-federation/esbuild`; ends up as NF-with-an-MF-manifest. Wasteful. |
| **Wrap `@module-federation/esbuild` + `@module-federation/runtime` into an Angular adapter** | ✅ | Reuses the real MF engine. The work is integration, not invention. |

### What we gain by *not* inventing

`@module-federation/esbuild` already solves the part that looked impossible:
shared-dependency resolution on esbuild. It does this with `onResolve`/`onLoad`
virtual modules that route a remote chunk's `import "@angular/core"` to
`container.loadShare('@angular/core')` against the global `__FEDERATION__`
shareScope. This is genuine MF runtime behavior, not an import-map shim.

---

## 2. Architecture: mirror the native-federation adapter

The NF adapter is three layers. We replicate the shape, swapping the engine:

```
                    Native Federation                Module Federation (this plan)
  ───────────────────────────────────────────────────────────────────────────────
  build core +      @softarc/native-federation       @module-federation/esbuild
  manifest          (federationBuilder, remoteEntry)  (plugin + writeRemoteManifest,
                                                       mf-manifest.json)
  ───────────────────────────────────────────────────────────────────────────────
  esbuild adapter   this repo's angular-esbuild-      (folded into the MF esbuild
                    adapter (NFBuildAdapter)           package)
  ───────────────────────────────────────────────────────────────────────────────
  Angular glue      THIS REPO  ←──────────────────→   THE NEW PROJECT
                    (builders, i18n, SSR, dev server,  (same responsibilities,
                     index.html, schematics, config)    MF-shaped)
  ───────────────────────────────────────────────────────────────────────────────
  runtime           orchestrator + es-module-shims    @module-federation/runtime
```

### 2.1 The critical integration decision: side-build vs. in-build plugin

`@module-federation/esbuild` wants to **own** the esbuild invocation: it injects
the container into `entryPoints`, sets `external`, toggles `write`/`metafile`,
and post-processes the metafile to fill `__MODULE_MAP__` and write the manifest.

Angular's `@angular/build:application` builder also owns all of that and exposes
only a narrow `codePlugins` slot. The two cannot both own the build.

**Decision: do not run the MF plugin inside Angular's main build.** Instead,
mirror exactly what this NF adapter does — run the **federation artifacts in a
separate esbuild build** that we control, while Angular builds the app shell.

This repo already proves the pattern:

- `builders/build/builder.ts` runs `buildApplication` / `serveWithVite` for the
  app, and separately drives `buildForFederation` (the NF core) through a custom
  esbuild adapter (`createAngularEsbuildContext` / `createNodeModulesEsbuildContext`).
- The `externals` plugin marks shared deps external in the Angular build so they
  are not double-bundled.

We do the same, but the "separate federation build" is driven by
`@module-federation/esbuild` instead of `@softarc/native-federation`.

```
ng build (our builder)
├── Angular app shell        → buildApplication(...)  (shared deps externalized)
└── Federation artifacts     → esbuild.build({ plugins: [moduleFederationPlugin(cfg)] })
       ├── remoteEntry.js (MF container)
       ├── mf-manifest.json
       └── exposed/shared chunks
```

---

## 3. Scope — what we build, phased

### Phase 0 — De-risk (BEFORE writing any Angular code)
Goal: prove `@module-federation/esbuild` carries Angular-shaped payloads.

- A bare, non-Angular repo: one remote exposing a component-like module, one host.
- Verify shared singletons resolve through `__FEDERATION__` (use a stateful module).
- Then escalate to the real risk: externalize and share `@angular/core` +
  `@angular/common` between two plain esbuild bundles and confirm a **single
  instance** (no `NG0203`).
- **Gate:** if shared Angular core can't be made a singleton here, the whole plan
  is in doubt. Stop and reassess before Phase 1.

### Phase 1 — Consumer (host) adapter — *highest value, lowest risk*
Goal: an Angular **host** loads existing MF v2 remotes (built by webpack/rspack/vite teams).

- Runtime wrapper over `@module-federation/runtime`:
  `initFederation(manifestOrRemotes)`, `loadRemoteModule({ remoteName, exposedModule })`
  — keep the **same public API shape** as this NF adapter's `index.ts` so migration
  is mechanical.
- Register the Angular host's `@angular/*` (+ rxjs, zone.js) into the shareScope as
  singletons via the runtime's share registration.
- Builder: externalize shared deps from the Angular build; no container needed for a
  pure host.
- **This alone is probably the real prize:** "consume MF remotes from Angular" is
  the thing teams say is near-impossible today.

### Phase 2 — Producer (remote) adapter
Goal: Angular **produces** remotes consumable by any MF v2 host.

- Wire the side esbuild build with `moduleFederationPlugin({ name, filename, exposes, shared })`.
- Emit `remoteEntry.js` + `mf-manifest.json` into Angular's browser output dir.
- Reconcile output naming/hashing/`baseHref` with Angular's output layout.
- Dev-server middleware to serve `remoteEntry.js` and chunks with CORS (mirror the
  middleware already in `builders/build/builder.ts`).

### Phase 3 — Config + schematics parity
- `withModuleFederation(config)` mirroring `withNativeFederation` (share/shareAll,
  skip-list, default platform detection).
- `ng add` / `ng g remote` / `ng g host` schematics.
- An Angular skip-list equivalent of `config/angular-skip-list.ts`.

### Phase 4 — SSR + i18n (the long tail)
- SSR: MF has a node/SSR story (`@module-federation/node`), but its interaction
  with Angular's server build pass + the `ngServerMode` shared-bundle patch
  (`angular-esbuild-adapter.ts:setNgServerMode`) is unverified. Treat as research.
- i18n: replicate `translateFederationArtifacts` against MF artifact names.
- **Both are optional for v1.** Ship CSR host+remote first.

---

## 4. Gaps (things that don't exist yet and we must build)

1. **The entire Angular glue layer.** Everything in this repo's `builders/`,
   `utils/i18n.ts`, `utils/update-index-html.ts`, dev-server middleware, schematics
   — none of it exists for MF. This is the bulk of the work, and it is genuinely
   substantial (this repo is not small).
2. **Container emission inside Angular's output contract.** Getting the side build's
   `remoteEntry.js` + chunks to land with correct hashing, `baseHref`, and
   `index.html` script wiring next to Angular's own output.
3. **Shared singleton bridging for Angular core.** A first-class config that
   guarantees `@angular/*` is `singleton: true, strictVersion` and actually
   resolves to one instance across host↔remote. The MF plugin supports the
   primitives; the Angular-correct defaults are ours to define.
4. **Watch / rebuild / HMR integration.** This repo has a non-trivial rebuild queue
   and NF file watcher synchronized with Angular's iterator
   (`RebuildQueue`, `createNfWatcher`). The side MF build needs equivalent
   incremental rebuild plumbing or dev DX will be poor.
5. **Dev SSR bridge.** This repo injects a dev-SSR bootstrap plugin
   (`devHostInstancesPlugin`) so the host's singletons reach remotes under
   `ng serve`. An MF equivalent must be designed from scratch.

## 5. Pitfalls (things that will bite during implementation)

- **`@module-federation/esbuild` maturity.** It is the least-exercised MF build
  integration (webpack/rspack/vite are the proven ones; the README states no
  production-readiness). Expect to file/fix upstream bugs. **This is the #1 risk.**
  Budget for forking/patching it.
- **The plugin wants to own the esbuild build.** Confirmed from source: it injects
  entry points and post-processes the metafile. Running it as the *side* build (not
  inside Angular's) avoids a fight — but means we own two builds and must keep their
  externals/shared config perfectly in sync, or we get duplicate framework copies.
- **Angular single-instance strictness (`NG0203`).** Any version skew or accidental
  double-bundle of `@angular/core` triggers it. The deep-research doc flagged exactly
  this. Strict singleton config + Phase-0 verification is mandatory, not optional.
- **CJS dependencies.** The MF plugin ships a `cjsToEsmPlugin` that calls
  `esbuild.build()` internally. Angular's ecosystem still has CJS deps; double
  CJS→ESM handling (Angular's + MF's) is a likely source of subtle breakage.
- **Two runtimes, one page.** If a host loads *both* MF remotes and (later) any NF
  remotes, `__FEDERATION__` and the import-map world don't share a shareScope.
  Pick one model per app; don't mix.
- **Version coupling to Angular internals.** This repo imports from
  `@angular/build/private` (`buildApplicationInternal`, `serveWithVite`,
  `SourceFileCache`). Those are unstable, version-pinned APIs. We inherit the same
  per-Angular-major maintenance treadmill (`README` versioning table proves the cost).
- **MF runtime version drift.** Host and remotes must agree on a compatible
  `@module-federation/runtime` major, or shareScope negotiation misbehaves. This is
  a cross-team governance burden NF avoids (the browser resolves import maps).

## 6. Tradeoffs — honest accounting

### What you GAIN over native-federation
- **MF v2 ecosystem interop.** Consume/expose remotes shared with webpack, rspack,
  rsbuild, vite, Next.js, Modern.js teams. This is the headline reason to do it.
- **MF DevTools** (Chrome extension), smart sidebar, proxying remotes to local.
- **Manifest-level tooling**: `mf-manifest.json`, stats, type-sharing
  (`@module-federation/dts-plugin`), retry/observability plugins.
- **A real shareScope runtime** with hooks (`errorLoadRemote`, fallbacks, version
  negotiation) that's more programmable than import-map negotiation.

### What you LOSE / pay vs. native-federation
- **You leave web standards.** NF resolves via native ESM + import maps; this
  reintroduces a JS container indirection layer on top of what the browser does
  natively. Philosophically the opposite of NF's thesis.
- **Heavier runtime.** `@module-federation/runtime` ships to every client; import
  maps are free.
- **A second, self-owned esbuild build** to maintain in lockstep with Angular's.
- **Maturity risk** concentrated in `@module-federation/esbuild`.
- **Cross-team version governance** for the MF runtime.
- **CORS is NOT bypassed** (a common MF claim): manifest/chunk `fetch`es still need
  CORS, same as NF. No win there.

### What stays the same (no better, no worse)
- Per-Angular-major maintenance treadmill (both adapters import Angular privates).
- SSR/i18n complexity — hard in both worlds.

## 7. Effort & sizing (rough, honest)

| Phase | Outcome | Rough effort | Risk |
| --- | --- | --- | --- |
| 0 | Bare-repo proof: Angular-core singleton over MF shareScope | days | **decisive** |
| 1 | Angular **host** consumes MF v2 remotes (CSR) | ~1–2 weeks | low |
| 2 | Angular **remote** consumable by MF hosts (CSR) | ~2–4 weeks | medium |
| 3 | Config helpers + schematics parity | ~1–2 weeks | low |
| 4 | SSR + i18n | open-ended | high |

"Production-grade adapter at parity with this repo" is a **multi-month** effort,
dominated by the Angular glue and the SSR/i18n tail — *not* by federation logic.
A **useful CSR host+remote** is achievable in weeks.

## 8. Recommended path

1. **Do Phase 0 first.** It is cheap and it is the go/no-go gate. If Angular core
   cannot be a clean singleton across two MF-esbuild bundles, stop.
2. **Ship Phase 1 (host consumer) as a standalone deliverable.** It is the highest
   value, lowest risk, and likely solves the actual pain ("consume MF remotes from
   Angular") on its own.
3. **Only then commit to Phase 2+** (producing remotes, config/schematics), treating
   SSR/i18n as explicitly out-of-scope for v1.
4. Keep the **public API identical** to this NF adapter (`initFederation`,
   `loadRemoteModule`, `withModuleFederation`/`share`/`shareAll`) so apps can switch
   engines with minimal churn — and so this plan stays a true "sibling adapter."

## 9. Open questions to resolve during Phase 0/1

- Does `@module-federation/esbuild` tolerate Angular's vendor graph size and CJS deps?
- Can shared `@angular/core` be pinned to a single instance reliably? (`NG0203`)
- Can the side build's outputs be hashed/served to match Angular's output + dev server?
- What is the minimum viable `mf-manifest.json` an Angular host must emit to be
  consumable by a stock webpack/rspack MF host (and vice-versa)?
- Is there an existing community attempt (e.g. `@ng-rsbuild`, AnalogJS) whose
  approach we should borrow or build on instead of esbuild?

---

### Appendix: source anchors in *this* repo to copy from
- `packages/angular/src/builders/build/builder.ts` — dual build orchestration,
  externals plugin, dev-server middleware, rebuild queue, watch sync.
- `packages/angular/src/utils/angular-esbuild-adapter.ts` — the `NFBuildAdapter`
  implementation + `setNgServerMode` patch (the template for our side build).
- `packages/angular/src/index.ts` — runtime API surface to keep identical.
- `packages/angular/src/config/share-utils.ts` — `withNativeFederation`/share defaults.
- `packages/angular/src/plugin/dev-host-instances-plugin.ts` — dev-SSR singleton bridge.

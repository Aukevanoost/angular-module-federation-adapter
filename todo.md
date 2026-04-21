# Localize support for `build-slim` — findings

Context: `packages/angular/src/builders/build-slim/` currently has no i18n handling.
Slim is a micro-frontend remote builder — no `main.ts`, no `polyfills.ts`, just
the federation artifacts (exposes + shared + chunks). The remote runs inside a
host shell that owns polyfills.

## How `@angular/build` does i18n (verified against `angular-build-cli-source-code/`)

1. `createI18nOptions(projectMetadata, options.localize, …)` in
   `src/utils/i18n-options.ts:77` parses `i18n` from `angular.json` into
   `{ sourceLocale, locales[].subPath, inlineLocales, shouldInline }`.
2. Before bundling, `loadActiveTranslations(context, i18nOptions)` populates
   in-memory translations via `@angular/localize` loaders
   (`src/builders/application/i18n.ts:175`).
3. During bundling, the Angular compiler plugin emits `$localize` tagged-template
   calls unchanged. The polyfills entry gets
   `(globalThis.$localize ??= {}).locale = "___NG_LOCALE_INSERT___";` as a
   placeholder (`src/tools/esbuild/application-code-bundle.ts:730`).
4. Post-bundle, if `shouldInline`, `inlineI18n()` spins up the `I18nInliner`
   worker pool and rewrites every output file per locale, moving files under
   `locales[locale].subPath` (`src/builders/application/i18n.ts:32`).

The linker plugin (which rewrites `$localize` calls) only runs when the
JavaScript transformer's `shouldLink` branch fires
(`src/tools/esbuild/javascript-transformer-worker.ts:73`). `advancedOptimizations`
does not touch `$localize`.

## Current full `build` builder behaviour

`packages/angular/src/builders/build/builder.ts` uses a hybrid approach:
- The Angular `buildApplication` call handles shell `$localize` inlining
  in-memory (Angular's own inliner).
- Federation artifacts produced by `buildForFederation` are post-processed by
  `translateFederationArtifacts` in `packages/angular/src/utils/i18n.ts:40`,
  which shells out to the `localize-translate` CLI over files already written
  to `<base>/browser/<sourceLocale>/`.
- `getLocaleFilter` / `sourceLocaleSegment` at `build/builder.ts:202-220`
  compute the locale-aware `browserOutputPath`.

## Why slim is different

- No shell build, so the "Angular inlines shell" half of the hybrid doesn't
  apply.
- The compiler plugin still emits raw `$localize` markers — nothing in the slim
  pipeline strips or inlines them (verified in
  `packages/angular/src/utils/create-awaitable-compiler-plugin.ts` and
  `packages/angular/src/utils/angular-bundler.ts`).
- Output files retain `$localize\`:@@id:text\`` calls as-is.

## Recommended approach: runtime `$localize`, host provides translations

Since `$localize` markers survive a slim build untouched, the host can load
translations at runtime before importing the remote:

```ts
import '@angular/localize/init';
import { loadTranslations } from '@angular/localize';

loadTranslations(await fetch(translationsUrl).then(r => r.json()));
// then loadRemoteModule(...)
```

No per-locale subfolders, no `localize-translate` CLI, no `@angular/localize`
build-time dep in the remote, no polyfills in the slim output.

## Open question: how does the host discover translation URLs?

`FederationInfo` (`node_modules/@softarc/native-federation/src/lib/domain/core/federation-info.contract.d.ts:1-7`)
has no i18n field. Three options:

1. **Convention only** — slim copies to `<remoteOutput>/i18n/messages.<locale>.json`.
   Host hard-codes the locale set. Simplest; host guesses on 404s.
2. **Sibling manifest** — slim emits `<remoteOutput>/i18n-manifest.json`
   alongside `remoteEntry.json` with `{ sourceLocale, locales: {<code>: <path>} }`.
   Host fetches it before `loadRemoteModule`. Self-describing; one extra
   round-trip. No upstream changes.
3. **Extend `remoteEntry.json`** — add `i18n?` to `FederationInfo` upstream.
   Cleanest; requires a PR to `@softarc/native-federation`.

**Recommendation:** option 2. Self-describing, no upstream coordination.

## Tasks (if we move forward with option 2)

- [ ] Schema: add `localize?: ApplicationBuilderOptions['localize']` passthrough
      to `build-slim/schema.d.ts` + `schema.json`.
- [ ] Read `i18n` config via `getI18nConfig(context)` in `build-slim/builder.ts`
      (reuse `packages/angular/src/utils/i18n.ts`).
- [ ] Resolve translation source files from `i18n.locales`. Accept JSON
      directly; if XLIFF is provided, parse via `@angular/localize/tools`
      loaders at build time (optional first pass — require JSON).
- [ ] Copy translation files to `<output>/browser/i18n/messages.<locale>.json`.
      Hook into `assets.ts` `copyAllAssets` / `copyChangedAssets` so watch mode
      updates them.
- [ ] Emit `<output>/browser/i18n-manifest.json` with
      `{ sourceLocale, locales: { <code>: "i18n/messages.<code>.json" } }`.
- [ ] Document in `packages/angular/README.md`: the runtime loading pattern and
      the one-time `ng extract-i18n` setup for the remote's tsconfig (slim
      doesn't build `main.ts`, so extraction needs `--build-target` or expose
      entry points configured).
- [ ] Consider a small helper in `@softarc/native-federation-runtime` (out of
      scope for this repo) such as
      `loadRemoteTranslations(remoteName, locale)`.

## Explicitly NOT doing (for now)

- Per-locale pre-translated output subfolders (Angular's inline path). Overkill
  for a remote — one bundle with markers + N translation JSONs is smaller to
  ship and simpler to maintain than N copies of every chunk.
- Bundling `@angular/localize/init` into the slim output. Host owns polyfills.
- Changes to `@softarc/native-federation`'s `FederationInfo` contract.

## Caveats

- `$localize.loadTranslations()` must run before any remote code containing
  `$localize` calls executes. Document ordering clearly.
- Slim produces no `main.ts`, so `ng extract-i18n` cannot run against the slim
  builder directly — the remote author configures extraction against the
  federation tsconfig / expose entry points. One-time setup, not slim's
  responsibility.
- If the user ever wants to slim-build a host (not just a remote), the
  polyfills-less / no-shell assumption breaks and the full `build` builder
  should be used instead.

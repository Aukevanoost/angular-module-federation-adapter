# `module-federation-angular-adapter`

An Angular adapter for **Module Federation v2**, built on
[`@module-federation/runtime`](https://www.npmjs.com/package/@module-federation/runtime)
and [`@module-federation/esbuild`](https://www.npmjs.com/package/@module-federation/esbuild).

It lets an Angular app **consume** and **produce** Module Federation v2 remotes that
interoperate with stock **webpack / rspack** MF hosts — while reusing Angular's
esbuild-based `ApplicationBuilder` and the same es-module-shims foundation as
[Native Federation](https://www.npmjs.com/package/@angular-architects/native-federation).

> [!WARNING]
> **Pre-release.** The adapter is code-complete and statically verified
> (type-checks, lints, unit tests pass), but its **end-to-end behaviour is not yet
> proven** in a real Angular app/browser. See
> [Constraints & known issues](./docs/known-issues.md). Not yet recommended for
> production.

## Features

- ✅ **Module Federation v2 interop** — emits `mf-manifest.json` + an ESM
  `remoteEntry.js`; consumes/produces remotes across Angular, webpack, and rspack.
- ✅ **Familiar config** — `withModuleFederation` / `share` / `shareAll`, the same
  shape Native Federation / the Module Federation plugin use.
- ✅ **Angular-native build** — delegates the app shell to Angular's fast esbuild
  `ApplicationBuilder`; runs the federation container as a side build.
- ✅ **Single-instance sharing** — `@angular/*`, `rxjs`, `zone.js` shared as strict
  singletons via the MF shared scope.

## Quick start

```bash
ng add module-federation-angular-adapter
```

Configure `federation.config.mjs`:

```js
import {
  withModuleFederation,
  shareAll,
} from "module-federation-angular-adapter/config";

export default withModuleFederation({
  name: "mfe1",
  // remotes only:
  exposes: { "./Component": "./src/app/app.component.ts" },
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: "auto",
    }),
    "@angular/core": {
      singleton: true,
      strictVersion: true,
      requiredVersion: "auto",
      includeSecondaries: true,
    },
  },
  skip: ["rxjs/ajax", "rxjs/fetch"],
});
```

Load a remote in the host:

```ts
import { initFederation } from "module-federation-angular-adapter";

const { loadRemoteModule } = initFederation({
  mfe1: "http://localhost:4201/mf-manifest.json",
});

const m = await loadRemoteModule("mfe1", "./Component");
```

Full walkthrough: **[docs/usage.md](./docs/usage.md)**.

## How it differs from Native Federation

Same adapter shape and es-module-shims loader; the **orchestrator** and the
**artifact contract** change.

|                  | Native Federation                         | This adapter                                  |
| ---------------- | ----------------------------------------- | --------------------------------------------- |
| Runtime          | `@softarc/native-federation-orchestrator` | `@module-federation/runtime`                  |
| Build core       | `@softarc/native-federation`              | `@module-federation/esbuild`                  |
| Manifest         | `remoteEntry.json`                        | `remoteEntry.js` + `mf-manifest.json` (MF v2) |
| `initFederation` | returns a `Promise`                       | **synchronous**                               |
| Interop          | NF hosts only                             | stock webpack / rspack MF v2 hosts            |

The trade: you gain the wider Module Federation v2 ecosystem; you depend on the
(currently early `0.0.x`) `@module-federation/esbuild`. See
[Architecture](./docs/architecture.md) for the full picture.

## Documentation

- **[Usage](./docs/usage.md)** — install, configure, load/expose remotes.
- **[Architecture](./docs/architecture.md)** — how it works and the design behind it.
- **[Constraints & known issues](./docs/known-issues.md)** — what to be aware of.
- **[SSR proposal (deferred)](./docs/research/ssr-proposal-future.md)** — why SSR is
  not yet supported.

## Credits

Built on the work of the Module Federation and Native Federation communities —
[Zack Jackson](https://github.com/ScriptedAlchemy) (Module Federation), the
[`@module-federation`](https://github.com/module-federation) team (`runtime` +
`esbuild`), [Manfred Steyer](https://github.com/manfredsteyer) and the Angular
Architects team (Native Federation, whose adapter this ports from), and the Angular
CLI team for the esbuild `ApplicationBuilder`.

## License

MIT

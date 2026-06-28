# Architectural Deep Dive: Module Federation v2 Runtime Orchestration, Manifest Protocols, and Native Federation Comparative Analysis

## 1. The Paradigm Shift of Module Federation v2

The evolution of micro-frontend architectures has been shaped by the challenge of balancing independent deployment cycles with runtime execution performance. The introduction of Module Federation in Webpack 5 established a dynamic code-sharing mechanism that transformed how enterprise-scale applications were built and deployed. However, the initial implementation suffered from tight coupling to Webpack's compiler internals, a lack of first-class TypeScript definition sharing, and limited runtime extensibility.

Module Federation v2 represents a complete architectural overhaul, developed collaboratively by the ByteDance Web Infra team and the original creator of Module Federation. This modern iteration decouples the core compilation engine from specific bundlers, establishing a highly optimized runtime orchestration layer. The system targets four core areas of the micro-frontend lifecycle: build execution, asset loading efficiency, runtime rendering, and data-fetching mechanisms.

```
Traditional Webpack 5 Federation (Tight Coupling):
[Compiler Internals] ──► [Webpack Runtime Chunks] ──► [Hardcoded Loading Mechanics]

Module Federation v2 (Decoupled & Standardized):
[Webpack / Rspack / Vite] ──► [Standardized Manifest] ──► [@module-federation/runtime]
```

To optimize asset loading, Module Federation v2 introduces two core pruning modes:

**`runtime-infer` Mode:** This approach operates with zero external dependencies and is ready for use out-of-the-box. During compilation, the bundler analyzes the user's tree-shaken shared bundles using the consumer's `usedExports`. At runtime, the orchestration engine attempts to reuse these pre-existing, optimized bundles. If the active bundle cannot satisfy the consumer's requirements, the runtime automatically falls back to loading the complete dependency to ensure application safety and completeness.

**`server-calc` Mode:** Designed for large enterprise systems, this mode delegates dependency analysis to a CI/CD process or specialized server. The server evaluates dependency usage across all independent applications in the network, pre-calculating a globally optimized shared-pruning plan. This eliminates the need for runtime negotiation, ensuring that only the absolute minimum amount of code is transmitted over the network.

This shared-dependency tree-shaking yields massive performance improvements. For instance, when an application integrates a large component library like Ant Design but only utilizes a small subset of components (such as Badge, Button, and List), the shared bundle size drops from 1404.2 KB to 344.0 KB—achieving a 75.5% reduction in transmitted code size.

```
Traditional Shared Loading:
[Host App] ───► Downloads Full Ant Design (1404.2 KB) ───► [Remote Component]

Module Federation v2 (runtime-infer):
[Host App] ───► Tree-Shakes Ant Design (344.0 KB Used) ───► [Remote Component]
                │
                └─► (Exports Insufficient?) ──► Auto-Fallback to Full Dependency
```

Additionally, Module Federation v2 addresses integration testing with systems like Rstest, which loads dynamic remotes inside real runtimes to match production behavior. This bridges the gap between simulated testing environments and actual runtime execution.

The architecture also supports React Server Components (RSC) and streaming Server-Side Rendering (SSR). Combining Module Federation with RSC allows organizations to execute components on the server, resulting in smaller browser bundles, faster performance, and safer data handling.

## 2. Structural Components of the Decoupled Runtime System

To achieve bundler independence, the Module Federation v2 architecture is split into modular npm packages. This separation ensures that the core orchestration engine remains unchanged whether the application is compiled with Webpack, Rspack, or Vite.

| Package Namespace | Core Architectural Role | Primary Operational Mechanics |
| --- | --- | --- |
| `@module-federation/runtime` | Core Runtime Engine | A bundler-independent library that implements the core `FederationHost` container orchestration engine. It manages the global share scope map, remote registration, and execution of runtime hooks. |
| `@module-federation/enhanced` | Build-Time Plugin Wrapper | Provides enhanced compilation plugins for Webpack and Rspack. In Rspack, these optimizations are compiled directly into the underlying Rust engine to achieve maximum performance. |
| `@module-federation/sdk` | Shared Compilation Utilities | Contains shared validation schemas, configuration parsers, and diagnostic utilities used by both build plugins and runtime modules. |
| `@module-federation/webpack-bundler-runtime` | Webpack Execution Bindings | Translates Webpack's legacy internal chunk-loading calls into standardized API invocations supported by the v2 runtime engine. |
| `@module-federation/runtime-tools` | Comprehensive Vanity Wrapper | A single, unified package that exports the runtime, SDK, and enhanced plugins. It simplifies updates and prevents version drift across federated applications. |

This decoupled structure allows teams to use Rspack and Webpack interdependently. For example, a legacy Webpack host can consume modern, highly optimized micro-frontends built with Rspack. This allows teams to progressively migrate to faster build tools without requiring a complete rewrite of the hosting platform.

## 3. Runtime Lifecycle and the FederationHost Execution Engine

At the center of Module Federation v2's runtime execution is the `FederationHost` class. Every micro-frontend container or host shell operates as an isolated instance of `FederationHost`. To coordinate these instances and prevent execution collisions, the runtime registers all active hosts in a global registry:

```
globalThis.__FEDERATION__
```

This global object acts as the primary registry, providing complete observability into loaded containers, active plugins, and resolved dependencies.

```
globalThis.__FEDERATION__
├── instances (Array of FederationHost)
│   ├── [0] Host Application (Shell)
│   │   ├── plugins (Runtime Hooks)
│   │   └── shareScopeMap (Shared Dependencies)
│   └── [1] Remote Application (MFE)
│       ├── plugins
│       └── shareScopeMap
└── __shareScopeMap__ (Global Shared Singletons)
```

The runtime orchestration engine follows a strict, asynchronous lifecycle to bootstrap applications, negotiate shared dependencies, and resolve remote modules without blocking the main thread:

```
[Host Startup]
│
▼
[Fetch Dynamic Manifest (mf-manifest.json)]
│
▼
[Run "beforeInit" Hook] ──► [Evaluate Global Share Scope Map]
│
▼
[Initialize Remote Containers]
│
▼
[Dynamic Import Boundary] (Main Execution Paused)
│
▼
[Run "beforeInitContainer" Hook]
│
▼
[Register Shared Singletons]
│
▼
[Evaluate App Code / Bootstrapping]
```

### Detailed Lifecycle Sequence

1. **Manifest Parsing and Remote Matching:** When a remote module is requested via `loadRemote('catalog/ProductCard')`, the orchestrator queries its registered remotes. It fetches and parses the remote's declarative manifest (`mf-manifest.json`) to determine its location and required dependencies.

2. **Hook Sequence Interception:** The orchestrator triggers the `beforeInit` hook, allowing runtime plugins to intercept or modify configuration parameters before the local `FederationHost` instance is created.

3. **Establishment of the Global Share Map:** The orchestrator parses the dependencies defined in the manifest and registers them in the global share scope map. The engine evaluates required versions, singletons, and semantic version constraints to select the most compatible candidates.

4. **Dynamic Import Boundary Execution:** To resolve dependencies safely, the application must use an asynchronous bootstrapping pattern. The standard execution flow is paused behind a dynamic `import('./bootstrap')` call. This ensures the orchestration engine has completely resolved and loaded all shared packages before any local or remote code is executed.

5. **Remote Container Initialization:** Once dependencies are resolved, the host invokes the remote container's asynchronous `init` method, passing the populated global share scope map to the remote.

6. **Module Retrieval and Factory Evaluation:** The host calls the remote container's `get` method to retrieve the requested module. The remote returns a synchronized module factory function, which is evaluated to produce the requested components or utilities.

### Core Runtime Lifecycle Hooks

The orchestration engine exposes a rich set of lifecycle hooks, allowing developers to inject custom logic at critical execution phases:

- **`beforeInit`:** Invoked with the runtime configuration options before a `FederationHost` instance is constructed. Useful for dynamically modifying CDN remote URLs based on environment variables or user roles.

- **`init`:** Triggered immediately after the host is initialized but before any external resources are fetched.

- **`beforeRequest`:** Fires before the orchestrator initiates a network request for a remote manifest or script chunk. Developers can use this hook to append authentication headers or dynamically modify request credentials.

- **`afterResolve`:** Executes after a remote's entry point has been resolved but before the dynamic script is injected into the DOM.

- **`beforeInitContainer`:** Triggers just before invoking the dynamic container's `init()` method.

- **`initContainer`:** Runs immediately after the container's `init()` method resolves, signaling that the remote is fully integrated and ready to expose its modules.

- **`beforeLoadShare`:** Executes before loading a shared package. This is where customized version matching can be enforced or overridden.

- **`errorLoadRemote`:** A critical error-handling hook that triggers when a remote fails to load due to network timeouts, server outages, or incorrect URLs. It allows developers to register backup remotes or inject fallback user interface components to keep the main application running.

## 4. The Manifest Protocol and Cryptographic Supply Chain Contracts

One of the most important design choices in Module Federation v2 is the shift from executable JavaScript entries (`remoteEntry.js`) to declarative JSON manifests (`mf-manifest.json`). This change establishes a governable deployment unit that allows applications to be updated independently without requiring host redeployments.

The build plugin produces three distinct artifacts for every remote application:

| File Name | Structural Metadata Role | Architectural Target |
| --- | --- | --- |
| `mf-manifest.json` | Core Runtime Contract | Contains the metadata schema that details exposed modules, shared dependencies, entry points, and subresource integrity (SRI) hashes. |
| `mf-stats.json` | Build-Time Stat Record | Contains detailed build metrics and asset relationship graphs. It is used by external CI/CD systems to perform static analysis and dependency validation. |
| `mf-debug.json` | Diagnostic Snapshot | Captured at the end of compilation, this file contains active compiler flags, plugin options, and normalized results used for troubleshooting. |

### Schema Structure and Fields of `mf-manifest.json`

The manifest file adheres to a strict JSON Schema, containing nested metadata objects that govern how the application is integrated at runtime:

```json
{
  "id": "app_catalog_01",
  "name": "catalog",
  "schemaVersion": "1.0.0",
  "metaData": {
    "pluginVersion": "2.3.3",
    "types": {
      "path": "./@mf-types.zip",
      "api": "./@mf-types.d.ts"
    },
    "ssrRemoteEntry": "static/node/ssrRemoteEntry.js"
  },
  "remoteEntry": {
    "path": "static/chunks/remoteEntry.js",
    "type": "esm",
    "integrity": "sha384-H4uWbI/K2eDoBIs0f5L5h6wYf1yWp6h18L1wG5m9Oq8r..."
  },
  "exposes": [
    {
      "key": "./ProductCard",
      "requires": ["react", "react-dom"],
      "assets": {
        "js": ["static/chunks/ProductCard.da812f.js"],
        "css": ["static/css/ProductCard.7fa921.css"]
      }
    }
  ],
  "shared": [
    {
      "packageName": "react",
      "version": "18.3.1",
      "requiredVersion": "^18.0.0",
      "singleton": true,
      "strictVersion": true,
      "assets": {
        "js": ["static/chunks/react.90a1f4.js"]
      }
    }
  ]
}
```

This protocol introduces a strict verification process. When a host loads a manifest, it checks the `schemaVersion`. If a major version mismatch is detected, the runtime immediately rejects the file with code `MFV-004` to prevent runtime crashes.

The manifest also manages Server-Side Rendering (SSR) assets. The build plugin detects when the compilation target is Node.js, generating an additional `ssrRemoteEntry` artifact and recording it in the manifest's metadata.

When rendering on the server, the runtime uses helper APIs like `createServerFederationInstance({ inBrowser: false })` and `collectFederationManifestPreloadLinks()` to extract and pre-render stylesheet and modulepreload links. This prevents flashes of unstyled content and ensures fast Time-to-Interactive (TTI) without crashing the renderer.

Crucially, the manifest enables secure, cross-origin resource loading. Standard browser import maps operate strictly within native security boundaries, meaning every script loaded from an external CDN must satisfy Cross-Origin Resource Sharing (CORS) policies.

In contrast, Module Federation runs within the application's bundled scope. Remotes load programmatically through the host application's context, allowing teams to bypass standard browser CORS restrictions and run federated code seamlessly across different domains.

## 5. Build-Plugin Mode vs. Pure Runtime Mode

Module Federation v2 supports two distinct configuration modes, allowing teams to choose the best approach for their application's needs.

| Architectural Feature | Build Plugin Mode | Pure Runtime Mode |
| --- | --- | --- |
| Registration Method | Declared statically within the bundler's configuration file (e.g. `rspack.config.ts`). | Registered dynamically at runtime using the `createInstance()` and `registerRemotes()` APIs. |
| Import Syntax | Uses standard, static JavaScript dynamic imports (e.g. `import('catalog/ProductCard')`). | Programmatic async calls to the orchestration engine (e.g. `loadRemote('catalog/ProductCard')`). |
| Dependency Resolution | Automatic and bidirectional, managed by the compiler during the build phase. | Manual; shared singletons must be explicitly registered via `registerShared()`. |
| TypeScript Type Sharing | Automated via the `@module-federation/dts-plugin`. It generates and extracts types as zip files (`@mf-types.zip`). | Manual configuration is required, pointing the consumer directly to type paths using `consumeTypes.remoteTypeUrls`. |
| Observability & DevTools | Excellent; integrates with Chrome DevTools and supports smart sidebar syncing. | Limited; requires manual instrumentation of performance and diagnostic events. |
| Best Used For | Standard enterprise applications with known remotes and consistent deployment pipelines. | Highly dynamic platforms, such as customizable CMS portals, dashboard widgets, and serverless Node runtimes. |

In Build Plugin Mode, the development experience is significantly enhanced by dynamic TypeScript type hints. In previous versions, importing remote modules meant losing static type information, forcing teams to maintain manual type definitions or use `any`.

The v2 plugin automatically generates and shares types at development time. It bundles typings into `@mf-types.zip` and syncs them in real-time across local ports, providing an `npm link`-like hot-reloading experience.

```
[Producer Dev Build] ──► Compiles Types ──► Generates @mf-types.zip
│
▼ (Exposed via local port)
[Consumer Dev Build] ──► Automatically Fetches & Unzips ──► Real-Time IDE Typings
```

To simplify debugging, Module Federation v2 provides an upgraded Chrome DevTools extension. The panel features a "Smart Sidebar Sync" that follows the user's navigation automatically without manual page refreshes.

It maps dependency relationships, evaluates active singletons, and allows developers to proxy remote modules from staging or production environments back to their local machine for real-time testing.

## 6. Advanced Dependency Selection and Loading Strategies: loaded-first vs. version-first

To manage shared dependencies across independent micro-frontends, Module Federation v2 provides two configuration modes: `version-first` and `loaded-first`.

### `version-first` Loading Strategy

This is the default strategy used by the Webpack and Rspack bundlers. It prioritizes version compatibility and strict semver matching.

- **Operational Mechanics:** During application startup, the orchestrator eagerly downloads the manifest files for all registered remotes. It evaluates the entire dependency graph, matches required semantic version ranges, and loads the highest compatible version of each library.

- **Offline Resilience:** This strategy is vulnerable to network failures during startup. If a remote container is offline, the initialization fetch will fail. This triggers the `errorLoadRemote` hook during the `beforeLoadShare` lifecycle phase. Without custom fallback plugins, the entire application may hang or fail to bootstrap.

### `loaded-first` Loading Strategy

This strategy prioritizes application performance and runtime resilience over strict semantic version matching.

- **Operational Mechanics:** The orchestrator does not download remote manifests during initialization. Instead, remotes are loaded lazily on demand when a specific module is requested. The runtime prioritizes reusing dependencies that are already loaded in memory.

- **Offline Resilience:** This strategy is highly resilient. If a remote container goes offline, it has zero impact on application startup. The application only encounters a loading failure if the user navigates to a feature served by that specific offline remote. However, this strategy is less deterministic, introducing the risk of loading duplicate dependency versions if a remote is requested after a fallback has already been initialized.

### Core Resolution Parameters

The orchestrator relies on four key configuration properties to manage shared dependencies and prevent conflicts:

```js
shared: {
  react: {
    singleton: true,
    requiredVersion: '^18.2.0',
    strictVersion: true,
    eager: false
  }
}
```

- **`singleton`:** A boolean flag ensuring that only a single instance of the dependency is loaded and instantiated in memory. This is critical for libraries that maintain global state, such as React, Vue, or state management stores.

- **`requiredVersion`:** Defines the acceptable semantic version range. If the host or another remote exposes a version outside this range, the orchestrator triggers a fallback behavior.

- **`strictVersion`:** If set to `true`, the orchestrator immediately throws a runtime error if a dependency version violating the `requiredVersion` range is encountered. If `false`, a console warning is emitted, and the engine falls back to loading its own bundled copy of the library.

- **`eager`:** When configured as `true`, the dependency is included directly in the initial application chunk rather than being fetched asynchronously on-demand. This optimizes startup performance but increases the host's initial payload size.

### The Side Effect Scanner

To prevent security and style conflicts before code is executed, Module Federation v2 introduces a static Side Effect Scanner CLI tool. This tool evaluates compiled bundles and identifies potential runtime side effects:

```
[Remote Build Output]
│
▼
┌─────────────────────────────────┐
│ Side Effect Scanner             │
├─────────────────────────────────┤
│ 1. Scan global variables        │
│ 2. Detect dynamic style bleed   │
│ 3. Check leaky event listeners  │
└─────────────────────────────────┘
│
▼
[Scan Report & Integration Warnings]
```

- **Global Variable Analysis:** Detects variables that are written to the global namespace, preventing dynamic remotes from polluting the browser's shared environment.

- **Dynamic Event Listeners:** Scans for active, non-removable event listeners that could persist and cause memory leaks after a micro-frontend is unmounted.

- **CSS Selector Bleed:** Analyzes CSS rules to identify global selectors that could bleed outside the micro-frontend boundary and break the host application's styles.

## 7. Comparative Analysis: Module Federation v2 vs. Native Federation

As organizations adopt micro-frontend architectures, they often evaluate two primary patterns: Module Federation v2 (a bundler-decoupled runtime engine) and Native Federation (a browser-native approach built on emerging web standards).

### Conceptual Framework Differences

**Module Federation v2:** Combines build-time optimizations with a runtime orchestration engine. It compiles applications into optimized chunks and manages them using a dynamic JavaScript engine. By running inside a managed virtual container, Module Federation v2 bypasses browser CORS limits and complex origin restrictions.

**Native Federation:** Designed to be framework- and tooling-agnostic, Native Federation does not rely on custom runtime container abstractions. Instead, it uses browser-native technologies: ECMAScript Modules (ESM) and native Import Maps.

The host and remotes are compiled into standard ES modules, and a lightweight orchestrator dynamically generates and injects import maps to resolve dependency mappings directly in the browser.

### Architectural Orchestration in Native Federation

Native Federation architectures typically leverage specialized runtime orchestrators, such as `@softarc/native-federation-runtime` or `vanilla-native-federation` (or `@softarc/native-federation-orchestrator`). These orchestrators parse the remote's configuration metadata file (`remoteEntry.json`), which details exposed modules, shared packages, compatible ranges, and target output paths.

```
                                  +---------------------------------------+
                                  |         Application Shell             |
                                  |       (Browser Native Engine)         |
                                  +------------------+--------------------+
                                                     |
                                            Reads Local Cache
                                                     |
                                                     v
                                  +---------------------------------------+
                                  |     vanilla-native-federation         |
                                  |         (Runtime Orchestrator)        |
                                  +--------+---------------------+--------+
                                           |                     |
                  Parses remoteEntry.json  |                     | Builds ESM Import Map
                                           v                     v
                         +-------------------+                 +-------------------+
                         |  remoteEntry.json |                 | <script type=     |
                         |  - Shared Meta    |                 |   "importmap">    |
                         |  - OutFileName    |                 +-------------------+
                         +-------------------+
```

Because traditional SPA routers do not reload the page during navigation, dynamic in-memory dependency mapping works efficiently. However, in server-rendered, multi-page architectures, every navigation triggers a full browser reload. This forces traditional runtime engines to recalculate shared dependency trees and rebuild the import maps repeatedly.

To solve this, orchestrators like `vanilla-native-federation` introduce advanced dependency caches that persist metadata and resolved versions in browser storage.

| Storage Strategy | Persistence Lifetime | Best Used For |
| --- | --- | --- |
| Memory Storage | Single page lifecycle; cleared on browser reload or navigation. | Local development, rapid hot reloading, and automated test environments. |
| Session Storage | Maintained for the duration of the browser tab session. | Multi-page applications or server-side rendered portals with frequent navigation. |
| Local Storage | Persistent; remains intact across browser restarts and sessions. | Aggressive production caching to minimize metadata fetches and maximize performance. |

This caching allows multi-page micro-frontends to reuse resolved dependency paths across hard route refreshes, preventing redundant script downloads.

Additionally, Native Federation orchestrators support a Strict Mode. If enabled, the orchestrator immediately fails if a dependency version conflict is detected, preventing inconsistent states at runtime.

For older browsers that do not natively support import maps, Native Federation relies on a polyfill like `es-module-shims`. When initialized with `shimMode: true`, it bypasses the browser's immutable-import-map constraint, allowing developers to dynamically register and update modules on-the-fly.

### Version Resolution and Framework Edge Cases

A critical limitation of Native Federation is its handling of complex tsconfig mappings. When compiling dependencies that do not exist in the root `package.json` or are defined via custom paths in `tsconfig.base.json`, the native-federation builder can fail to resolve the actual version metadata.

In these cases, the builder can default to writing empty strings (`""`) or `"0.0.0"` into the output config, which bypasses semver negotiation and causes resolution failures.

These resolution failures can result in duplicate framework instances being loaded in the browser. In Angular-based micro-frontends, loading duplicate copies of core packages like `@angular/core` will trigger standard framework runtime errors, such as:

```
NG0203: Injector already destroyed or multiple Angular instances active
```

This error commonly occurs when version mismatches (e.g. `@angular/core` 19.2.0 vs 19.2.15) fail to resolve correctly, forcing the browser to load separate bundles and break dependency injection.

### In-Depth Feature and Benchmark Comparison

The following comparison details the operational and performance differences between Module Federation v2 and Native Federation:

| Comparative Dimension | Module Federation v2 | Native Federation |
| --- | --- | --- |
| Underlying Technology | Decoupled runtime managing isolated JS execution scopes. | ECMAScript Modules (ESM) and browser-native Import Maps. |
| Bundler Requirements | Highly optimized with Webpack and Rspack. Supports Vite via custom plugins. | Fully tooling-agnostic; works with Webpack, Vite, esbuild, Rollup, or Rolldown. |
| TypeScript Type Safety | Automated; build plugins extract and sync types seamlessly. | Requires secondary packages (e.g. `@module-federation/native-federation-typescript`). |
| HMR Performance | Extremely fast under Rspack (~200ms–400ms). | Excellent in dev mode under Vite (~500ms). |
| CORS Constraints | Bypasses CORS; evaluates code programmatically inside a bundled context. | Must satisfy standard browser CORS requirements for all external assets. |
| Angular Integration | No official, framework-specific plugins for recent versions. | First-class integration; delegates directly to Angular's esbuild ApplicationBuilder. |
| Browser Compatibility | Universal; works in all legacy and modern browsers. | Requires an import-map polyfill (such as `es-module-shims`) for older browsers. |
| Cold Build (Large App) | Rspack + MF2: ~22 seconds / Webpack 5 + MF1: ~180 seconds. | esbuild + Native Federation: ~8 seconds. |

## 8. Strategic Architectural Conclusions and Synthesis

The choice between Module Federation v2 and Native Federation is a strategic decision that shapes an organization's deployment architecture and developer workflow.

```
                     Are you building an Angular-only app?
                                   │
                    ┌──────────────┴──────────────┐
                    ▼ (Yes)                       ▼ (No)
        [Native Federation]             Do you use Webpack/Rspack?
                                                  │
                                   ┌──────────────┴──────────────┐
                                   ▼ (Yes)                       ▼ (No)
                      [Module Federation v2]            Are you on Vite/Rolldown?
                                                                 │
                                                   ┌─────────────┴─────────────┐
                                                   ▼ (Yes)                     ▼ (No)
                                       [Vite Federation Plugin]        [Import Maps / Custom]
```

### Strategic Recommendations for Module Federation v2

Module Federation v2 is the ideal choice for large-scale enterprise architectures that require:

- **High Performance with Rspack:** Organizations that want to migrate to Rust-based bundlers to improve build speeds by 5–10x, reducing cold builds from minutes to seconds.

- **Automated Type Safety:** Teams working in large monorepos or distributed repositories that need robust compile-time safety and automatic type synchronization across application boundaries.

- **Flexible Caching & Version Control:** Platforms that require dynamic remote registration, server-side rendering (SSR) compatibility, and advanced version resolution strategies to manage complex dependency trees.

### Strategic Recommendations for Native Federation

Native Federation is the ideal choice for architectures that prioritize:

- **Angular CLI Standard Alignment:** Projects built with Angular 17 or newer. Native Federation stays aligned with Angular's official esbuild-based compilation pipeline, avoiding custom compiler patches.

- **Standard Web APIs:** Teams that want to leverage browser-native ECMAScript Modules (ESM) and Import Maps directly to minimize custom framework wrappers and tooling lock-in.

- **Multi-Page or Legacy Server Integrations:** Server-rendered architectures (such as Java, PHP, or Rails) that trigger full browser reloads on navigation. Utilizing custom caching orchestrators ensures fast load times and optimized asset reuse across hard refreshes.

// Phase 1 — orchestrator swap (M1.2/M1.3).
// Runtime moved from `@softarc/native-federation-orchestrator` to
// `@module-federation/runtime` (`createInstance` + `loadRemote`). The NF-shaped
// public surface (`initFederation`/`loadRemoteModule`) is kept for adoption
// familiarity; NF-only options (`shimMode`, `sse`, `cacheTag`) are dropped.
// NB finding #6: MF-esbuild still shares modules via es-module-shims import maps,
// so the loader is unchanged — only the registration/manifest API differs.
// M3.5: the NF `@softarc/.../domain` re-export and the `Imports`/`Scopes`/`ImportMap`
// import-map types are removed — this entry is now pure MF.
import {
  createInstance,
  type ModuleFederation,
  type ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

/**
 * Options for {@link FederationInstance.loadRemoteModule}.
 *
 * @property remoteName - Name of the remote as registered in
 *   {@link initFederation}, or derived from `remoteEntry`.
 * @property remoteEntry - URL to the remote's `remoteEntry.js` / `mf-manifest.json`.
 *   Enables lazy-loading remotes not registered up front (wired in M1.3).
 * @property exposedModule - Key exposed by the remote (e.g. `'./Component'`).
 * @property fallback - Value returned on failure. Truthy-only — `null`/`0`/`''`
 *   count as "no fallback".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoadRemoteModuleOptions<T = any> = {
  remoteEntry?: string;
  remoteName?: string;
  exposedModule: string;
  fallback?: T;
};

/** MF runtime `shared` map, derived from `createInstance` so we don't reach into the transitive `runtime-core`. */
export type SharedConfig = NonNullable<Parameters<typeof createInstance>[0]['shared']>;

/**
 * Framework packages that MUST resolve to a single instance, or Angular trips
 * `NG0203`. Registered as MF singletons (M0.2's mandated config).
 *
 * `requiredVersion: false` for now — the singleton is enforced but the version
 * check is relaxed, because resolving the installed version (NF's
 * `requiredVersion: 'auto'`) is a config-build-time concern owned by
 * `withModuleFederation` in **M3.1**; once that lands it feeds concrete ranges
 * here. The actual module sharing flows through es-module-shims import maps at
 * runtime (finding #6) — this map only declares the singleton/version contract.
 */
export const DEFAULT_ANGULAR_SHARED: SharedConfig = {
  '@angular/core': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  '@angular/common': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  '@angular/common/http': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  '@angular/router': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  '@angular/platform-browser': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  rxjs: { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
  'zone.js': { shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } },
};

/**
 * Options for {@link initFederation}. NF-native knobs (`shimMode`, `sse`,
 * `cacheTag`, `logging`) are intentionally dropped — MF manages its import map
 * internally and exposes behaviour through runtime plugins instead.
 */
export interface InitFederationOptions {
  /** Instance name registered with the MF share scope (default `'host'`). */
  name?: string;
  /** MF runtime plugins (replaces NF's `shimMode`/`esmsInitOptions`). */
  runtimePlugins?: ModuleFederationRuntimePlugin[];
  /** Override the default MF share scope name. */
  shareScope?: string;
  /**
   * Shared singletons to register. Merged over {@link DEFAULT_ANGULAR_SHARED}
   * (pass `{}` and spread a filtered default to opt out of a framework dep).
   */
  shared?: SharedConfig;
}

/**
 * Handle returned by {@link initFederation}. Holds the live MF instance and the
 * `loadRemoteModule` bound to it. (The NF-era module-scoped standalone
 * `loadRemoteModule` export was dropped in M1.3 — destructure from here instead.)
 */
export interface FederationInstance {
  /** Load an exposed module from a registered remote. */
  loadRemoteModule<T = unknown>(
    remoteName: string,
    exposedModule: string
  ): Promise<T>;
  loadRemoteModule<T = unknown>(options: LoadRemoteModuleOptions<T>): Promise<T>;
  /** The underlying `@module-federation/runtime` instance, for advanced use. */
  readonly instance: ModuleFederation;
}

/** name → remoteEntry/manifest URL (the MF-native `entry` of each remote). */
type RemotesMap = Record<string, string>;

function toRemotes(remotes: RemotesMap) {
  return Object.entries(remotes).map(([name, entry]) => ({ name, entry }));
}

/** Strip a leading `./` so `'./Component'` → `'Component'` for the MF id. */
function exposedKey(exposedModule: string): string {
  return exposedModule.replace(/^\.\//, '');
}

function normalizeOptions<T>(
  optionsOrRemoteName: LoadRemoteModuleOptions<T> | string,
  exposedModule?: string
): LoadRemoteModuleOptions<T> {
  if (typeof optionsOrRemoteName === 'string' && exposedModule) {
    return { remoteName: optionsOrRemoteName, exposedModule };
  }
  if (typeof optionsOrRemoteName === 'object' && !exposedModule) {
    return optionsOrRemoteName;
  }
  throw new Error(
    'unexpected arguments: please pass options or a remoteName/exposedModule-pair'
  );
}

function logClientError(error: string): void {
  if (typeof window !== 'undefined') {
    console.error(error);
  }
}

/**
 * Derive a remote's name from its `mf-manifest.json` URL (the lazy path's entry
 * must be the JSON manifest — its top-level `name`, per M0.4 — not `remoteEntry.js`).
 */
async function resolveRemoteNameFromEntry(remoteEntry: string): Promise<string> {
  const res = await fetch(remoteEntry);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch remote manifest at ${remoteEntry}: ${res.status} ${res.statusText}`
    );
  }
  const info = (await res.json()) as { name?: string };
  if (!info.name) {
    throw new Error(`manifest at ${remoteEntry} does not declare a 'name'`);
  }
  return info.name;
}

async function loadFromInstance<T>(
  mf: ModuleFederation,
  optionsOrRemoteName: LoadRemoteModuleOptions<T> | string,
  exposedModule?: string
): Promise<T> {
  const options = normalizeOptions<T>(optionsOrRemoteName, exposedModule);
  const { fallback } = options;
  try {
    // Lazy path: a remote not declared at initFederation time. Resolve its name
    // from the manifest if omitted, then register it before loading.
    if (!options.remoteName && options.remoteEntry) {
      options.remoteName = await resolveRemoteNameFromEntry(options.remoteEntry);
    }
    if (options.remoteEntry && options.remoteName) {
      mf.registerRemotes(
        [{ name: options.remoteName, entry: options.remoteEntry }],
        { force: true }
      );
    }
    if (!options.remoteName) {
      throw new Error(
        'loadRemoteModule: pass remoteName, or a remoteEntry pointing at an mf-manifest.json that declares a name'
      );
    }
    const id = `${options.remoteName}/${exposedKey(options.exposedModule)}`;
    const module = await mf.loadRemote<T>(id);
    if (module === null) {
      throw new Error(`loadRemote returned null for '${id}'`);
    }
    return module;
  } catch (err) {
    if (fallback) {
      logClientError(
        'error loading remote module: ' +
          (err instanceof Error ? err.message : String(err))
      );
      return fallback;
    }
    throw err;
  }
}

/**
 * Initialise Module Federation for an Angular host.
 *
 * Unlike NF's promise-returning init, this is **synchronous** — MF's
 * `createInstance` is sync and remotes load lazily on first `loadRemoteModule`.
 *
 * ```ts
 * const { loadRemoteModule } = initFederation({ mfe1: 'http://localhost:4201/remoteEntry.js' });
 * const m = await loadRemoteModule('mfe1', './Component');
 * ```
 *
 * @param remotes - name → remoteEntry/manifest URL map. (A bare manifest-URL
 *   string, like NF's `remotesOrManifestUrl`, is deferred to M1.7.)
 * @param options - {@link InitFederationOptions}.
 */
export function initFederation(
  remotes: RemotesMap = {},
  options?: InitFederationOptions
): FederationInstance {
  if (typeof remotes === 'string') {
    throw new Error(
      'initFederation: passing a manifest URL string is not supported yet (M1.7); pass a { name: entryUrl } map'
    );
  }

  const mf = createInstance({
    name: options?.name ?? 'host',
    remotes: toRemotes(remotes),
    // Host `@angular/*` (+ rxjs/zone.js) singletons (M1.4); caller overrides win.
    shared: { ...DEFAULT_ANGULAR_SHARED, ...options?.shared },
    plugins: options?.runtimePlugins ?? [],
    shareStrategy: 'loaded-first',
  });

  const instance: FederationInstance = {
    instance: mf,
    loadRemoteModule<T = unknown>(
      optionsOrRemoteName: LoadRemoteModuleOptions<T> | string,
      exposedModule?: string
    ): Promise<T> {
      return loadFromInstance<T>(mf, optionsOrRemoteName, exposedModule);
    },
  };
  return instance;
}

import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks/index.js';
import {
  addPackageJsonDependency,
  NodeDependencyType,
} from '@schematics/angular/utility/dependencies';

// Runtime dependencies a consuming app needs for Module Federation v2. Pinned to
// the same versions the adapter is built against to avoid runtime version skew.
const RUNTIME_DEPENDENCIES: { name: string; version: string }[] = [
  // The MF-esbuild container shares modules via es-module-shims import maps
  // (loaded on the page through the polyfills).
  { name: 'es-module-shims', version: '^2.8.0' },
  { name: '@module-federation/runtime', version: '2.6.0' },
  { name: '@module-federation/sdk', version: '2.6.0' },
  // Imported by the generated container as a bare specifier resolved from the
  // app's node_modules — undeclared upstream, so it must be listed explicitly.
  { name: '@module-federation/webpack-bundler-runtime', version: '2.6.0' },
];

export function addDependencies(tree: Tree, context: SchematicContext): void {
  for (const dep of RUNTIME_DEPENDENCIES) {
    addPackageJsonDependency(tree, {
      name: dep.name,
      type: NodeDependencyType.Default,
      version: dep.version,
      overwrite: false,
    });
  }

  context.addTask(new NodePackageInstallTask());
}

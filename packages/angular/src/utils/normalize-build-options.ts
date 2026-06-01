import type { ApplicationBuilderOptions } from '@angular/build';

/**
 * Vendored from `@angular/build` (`normalize-optimization.ts`, `normalize-source-maps.ts`).
 * These helpers aren't on the public or `/private` export surface.
 *
 * Types are derived from the public `ApplicationBuilderOptions`. Emitted declarations don't
 * reference Angular's internal schema module.
 */

type Optimization = NonNullable<ApplicationBuilderOptions['optimization']>;
type OptimizationObject = Extract<Optimization, object>;
type Styles = Extract<NonNullable<OptimizationObject['styles']>, object>;
type Fonts = Extract<NonNullable<OptimizationObject['fonts']>, object>;

type NormalizedOptimization = Required<Omit<OptimizationObject, 'fonts' | 'styles'>> & {
  fonts: Fonts;
  styles: Styles;
};

type SourceMap = NonNullable<ApplicationBuilderOptions['sourceMap']>;
type NormalizedSourceMap = Extract<SourceMap, object>;

export function normalizeOptimization(optimization: Optimization = true): NormalizedOptimization {
  if (typeof optimization === 'object') {
    const styleOptimization = !!optimization.styles;

    return {
      scripts: !!optimization.scripts,
      styles:
        typeof optimization.styles === 'object'
          ? optimization.styles
          : {
              minify: styleOptimization,
              removeSpecialComments: styleOptimization,
              inlineCritical: styleOptimization,
            },
      fonts:
        typeof optimization.fonts === 'object'
          ? optimization.fonts
          : {
              inline: !!optimization.fonts,
            },
    };
  }

  return {
    scripts: optimization,
    styles: {
      minify: optimization,
      inlineCritical: optimization,
      removeSpecialComments: optimization,
    },
    fonts: {
      inline: optimization,
    },
  };
}

export function normalizeSourceMaps(sourceMap: SourceMap): NormalizedSourceMap {
  const scripts = typeof sourceMap === 'object' ? sourceMap.scripts : sourceMap;
  const styles = typeof sourceMap === 'object' ? sourceMap.styles : sourceMap;
  const hidden = (typeof sourceMap === 'object' && sourceMap.hidden) || false;
  const vendor = (typeof sourceMap === 'object' && sourceMap.vendor) || false;
  const sourcesContent = typeof sourceMap === 'object' ? sourceMap.sourcesContent : sourceMap;

  return {
    vendor,
    hidden,
    scripts,
    styles,
    sourcesContent,
  };
}

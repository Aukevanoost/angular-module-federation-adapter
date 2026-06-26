import { requiresLinking } from './node-modules-bundler.js';

describe('requiresLinking', () => {
  it('returns true for partially-compiled sources containing a declaration prefix', () => {
    const source = 'export const x = ɵɵngDeclareComponent({ ... });';
    expect(requiresLinking('/node_modules/my-design-system/fesm2022/lib.mjs', source)).toBe(true);
  });

  it('returns false for sources without a declaration prefix', () => {
    expect(requiresLinking('/node_modules/some-lib/index.js', 'export const x = 1;')).toBe(false);
  });

  it('excludes @angular/core even if it contains the declaration prefix', () => {
    const source = 'ɵɵngDeclareClassMetadata(...)';
    expect(requiresLinking('/node_modules/@angular/core/fesm2022/core.mjs', source)).toBe(false);
  });

  it('excludes @angular/compiler even if it contains the declaration prefix', () => {
    const source = 'ɵɵngDeclareComponent(...)';
    expect(requiresLinking('/node_modules/@angular/compiler/fesm2022/compiler.mjs', source)).toBe(
      false
    );
  });

  it('matches @angular paths using either path separator', () => {
    const source = 'ɵɵngDeclareDirective(...)';
    expect(requiresLinking('C:\\node_modules\\@angular\\core\\core.mjs', source)).toBe(false);
  });

  it('does not exclude other @angular packages such as @angular/common', () => {
    const source = 'ɵɵngDeclarePipe(...)';
    expect(requiresLinking('/node_modules/@angular/common/fesm2022/common.mjs', source)).toBe(true);
  });
});

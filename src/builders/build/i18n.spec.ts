import * as fs from 'fs';
import { execSync } from 'child_process';
import { logger } from '@softarc/native-federation/internal';
import type { BuilderContext } from '@angular-devkit/architect';
import type { FederationInfo } from '@softarc/native-federation';

import { getI18nConfig, translateFederationArtifacts, type I18nConfig } from './i18n.js';

vi.mock('fs');
vi.mock('child_process');

const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

const federationResult = {
  shared: [{ outFileName: 'dep1.js' }],
  exposes: [{ outFileName: './cmp.js' }],
  chunks: { c1: ['chunk1.js'] },
} as unknown as FederationInfo;

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  infoSpy.mockRestore();
  debugSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('getI18nConfig', () => {
  it('reads the i18n config from the project metadata', async () => {
    const i18n = { sourceLocale: 'en', locales: { de: 'm.de.xlf' } };
    const getProjectMetadata = vi.fn().mockResolvedValue({ i18n });
    const context = {
      target: { project: 'my-app' },
      getProjectMetadata,
    } as unknown as BuilderContext;

    const result = await getI18nConfig(context);

    expect(getProjectMetadata).toHaveBeenCalledWith('my-app');
    expect(result).toBe(i18n);
  });

  it('returns undefined when no i18n config is present', async () => {
    const context = {
      target: { project: 'my-app' },
      getProjectMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as BuilderContext;

    expect(await getI18nConfig(context)).toBeUndefined();
  });
});

describe('translateFederationArtifacts', () => {
  const i18n: I18nConfig = {
    sourceLocale: 'en',
    locales: {
      de: 'src/locale/messages.de.xlf',
      fr: { translation: ['a.xlf', 'b.xlf'] },
    },
  };

  beforeEach(() => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('translated ok'));
  });

  it('does nothing when no configured locale matches the requested ones', async () => {
    await translateFederationArtifacts(i18n, ['es'], '/dist', federationResult);

    expect(execSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('filters to the intersection of requested and configured locales', async () => {
    await translateFederationArtifacts(i18n, ['de'], '/dist', federationResult);

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('--target-locales de');
    expect(cmd).not.toContain(' fr');
  });

  it('builds the localize-translate command from the federation output files', async () => {
    await translateFederationArtifacts(i18n, true, '/dist', federationResult);

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('localize-translate');
    expect(cmd).toContain('-s "{dep1.js,./cmp.js,chunk1.js}"');
    expect(cmd).toContain('--target-locales de fr');
    expect(cmd).toContain('-l en');
    // source locale dir is part of the -r reference path
    expect(cmd).toMatch(/-r "[^"]*browser\/en"/);
    // both translation file groups are passed
    expect(cmd).toContain('"src/locale/messages.de.xlf"');
    expect(cmd).toContain('["a.xlf","b.xlf"]');
  });

  it('uses sourceLocale.code when the source locale is an object', async () => {
    const objLocaleI18n: I18nConfig = {
      sourceLocale: { code: 'en-US' },
      locales: { de: 'm.de.xlf' },
    };

    await translateFederationArtifacts(objLocaleI18n, true, '/dist', federationResult);

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('-l en-US');
  });

  it('creates a dist folder and copies the MF artifacts for each target locale', async () => {
    // Both federation artifacts exist at the source locale.
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await translateFederationArtifacts(i18n, true, '/dist', federationResult);

    const mkdirPaths = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]));
    expect(mkdirPaths.some(p => p.endsWith('browser/de'))).toBe(true);
    expect(mkdirPaths.some(p => p.endsWith('browser/fr'))).toBe(true);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.any(String), { recursive: true });

    // remoteEntry.js + mf-manifest.json, each into de + fr = 4 copies (M4.2).
    expect(fs.copyFileSync).toHaveBeenCalledTimes(4);
    const copyTargets = vi.mocked(fs.copyFileSync).mock.calls.map(c => String(c[1]));
    expect(copyTargets.some(p => p.endsWith('browser/de/remoteEntry.js'))).toBe(true);
    expect(copyTargets.some(p => p.endsWith('browser/fr/remoteEntry.js'))).toBe(true);
    expect(copyTargets.some(p => p.endsWith('browser/de/mf-manifest.json'))).toBe(true);
    expect(copyTargets.some(p => p.endsWith('browser/fr/mf-manifest.json'))).toBe(true);
  });

  it('skips federation artifacts that do not exist at the source locale', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await translateFederationArtifacts(i18n, true, '/dist', federationResult);
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('logs an error when the translate command fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('localize boom');
    });

    await translateFederationArtifacts(i18n, ['de'], '/dist', federationResult);

    expect(errorSpy).toHaveBeenCalledWith('localize boom');
  });
});

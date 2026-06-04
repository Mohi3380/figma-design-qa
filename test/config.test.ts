import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG, loadConfig, resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('returns defaults for an empty object', () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial config over defaults', () => {
    const config = resolveConfig({
      figma: { fileKey: 'AbC123', frames: ['12:345'] },
      target: { baseUrl: 'http://localhost:3000', routes: ['/signup'] },
      tolerances: { positionPx: 8 },
    });
    expect(config.figma.fileKey).toBe('AbC123');
    expect(config.figma.source).toBe('rest'); // default preserved
    expect(config.tolerances.positionPx).toBe(8);
    expect(config.tolerances.colorDeltaE).toBe(3); // default preserved
    expect(config.viewports).toEqual([1440, 768, 375]);
  });

  it('rejects unknown top-level keys', () => {
    expect(() => resolveConfig({ tollerances: {} })).toThrow(ConfigError);
  });

  it('rejects unknown tolerance keys', () => {
    expect(() => resolveConfig({ tolerances: { positionsPx: 4 } })).toThrow(ConfigError);
  });

  it('rejects invalid figma.source', () => {
    expect(() => resolveConfig({ figma: { source: 'graphql' } })).toThrow(/figma.source/);
  });

  it('rejects unknown pointer types', () => {
    expect(() => resolveConfig({ pointers: ['existence', 'vibes'] })).toThrow(/vibes/);
  });

  it('rejects invalid severityGate', () => {
    expect(() => resolveConfig({ severityGate: 'urgent' })).toThrow(/severityGate/);
  });

  it('rejects empty or non-numeric viewports', () => {
    expect(() => resolveConfig({ viewports: [] })).toThrow(/viewports/);
    expect(() => resolveConfig({ viewports: ['1440'] })).toThrow(/viewports/);
  });

  it('does not mutate the shared defaults', () => {
    const config = resolveConfig({ tolerances: { positionPx: 99 } });
    config.viewports.push(9999);
    expect(DEFAULT_CONFIG.tolerances.positionPx).toBe(4);
    expect(DEFAULT_CONFIG.viewports).toEqual([1440, 768, 375]);
  });
});

describe('loadConfig', () => {
  it('returns defaults when the file is missing and optional', async () => {
    const config = await loadConfig(path.join(tmpdir(), 'definitely-missing-config.json'));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('throws when the file is missing and required', async () => {
    await expect(
      loadConfig(path.join(tmpdir(), 'definitely-missing-config.json'), { optional: false }),
    ).rejects.toThrow(ConfigError);
  });

  it('loads and merges a real file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'design-qa-'));
    const file = path.join(dir, 'design-qa.config.json');
    await writeFile(file, JSON.stringify({ severityGate: 'critical' }), 'utf8');
    const config = await loadConfig(file);
    expect(config.severityGate).toBe('critical');
  });

  it('reports invalid JSON with the file path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'design-qa-'));
    const file = path.join(dir, 'design-qa.config.json');
    await writeFile(file, '{ not json', 'utf8');
    await expect(loadConfig(file)).rejects.toThrow(/not valid JSON/);
  });
});

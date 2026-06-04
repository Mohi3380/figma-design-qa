/**
 * Loader for `design-qa.config.json` (spec §9).
 *
 * The config is optional on the CLI path (two-URL contract, §14) — CLI flags
 * can supply everything. When a config file exists, CLI flags override it.
 * Unknown keys are rejected loudly so typos don't silently disable checks.
 */
import { readFile } from 'node:fs/promises';

export interface Tolerances {
  positionPx: number;
  sizePx: number;
  colorDeltaE: number;
  fontSizeExact: boolean;
}

export type PointerType =
  | 'existence'
  | 'position'
  | 'size'
  | 'color'
  | 'typography'
  | 'spacing'
  | 'text'
  | 'asset'
  | 'visual';

export interface DesignQaConfig {
  figma: {
    fileKey?: string;
    frames: string[];
    source: 'mcp' | 'rest';
  };
  target: {
    baseUrl?: string;
    routes: string[];
  };
  viewports: number[];
  tolerances: Tolerances;
  pointers: PointerType[];
  matching: { preferAttribute: string };
  severityGate: 'critical' | 'high' | 'medium' | 'low' | 'info';
  vision: { enabled: boolean; model: string };
}

export const DEFAULT_CONFIG: DesignQaConfig = {
  figma: { frames: [], source: 'rest' },
  target: { routes: [] },
  viewports: [1440, 768, 375],
  tolerances: {
    positionPx: 4,
    sizePx: 2,
    colorDeltaE: 3,
    fontSizeExact: true,
  },
  pointers: [
    'existence',
    'position',
    'size',
    'color',
    'typography',
    'spacing',
    'text',
    'asset',
    'visual',
  ],
  matching: { preferAttribute: 'data-figma-id' },
  severityGate: 'high',
  vision: { enabled: true, model: 'claude-opus-4-8' },
};

const TOP_LEVEL_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const VALID_POINTERS = new Set<string>(DEFAULT_CONFIG.pointers);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

export class ConfigError extends Error {}

/** Merge a parsed config object over the defaults, validating as we go. */
export function resolveConfig(raw: unknown): DesignQaConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('Config root must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(`Unknown config key "${key}".`);
    }
  }

  const config: DesignQaConfig = structuredClone(DEFAULT_CONFIG);

  if (obj.figma !== undefined) {
    const figma = expectObject(obj.figma, 'figma');
    if (figma.fileKey !== undefined) config.figma.fileKey = expectString(figma.fileKey, 'figma.fileKey');
    if (figma.frames !== undefined) config.figma.frames = expectStringArray(figma.frames, 'figma.frames');
    if (figma.source !== undefined) {
      const source = expectString(figma.source, 'figma.source');
      if (source !== 'mcp' && source !== 'rest') {
        throw new ConfigError(`figma.source must be "mcp" or "rest", got "${source}".`);
      }
      config.figma.source = source;
    }
  }

  if (obj.target !== undefined) {
    const target = expectObject(obj.target, 'target');
    if (target.baseUrl !== undefined) config.target.baseUrl = expectString(target.baseUrl, 'target.baseUrl');
    if (target.routes !== undefined) config.target.routes = expectStringArray(target.routes, 'target.routes');
  }

  if (obj.viewports !== undefined) {
    const viewports = obj.viewports;
    if (!Array.isArray(viewports) || viewports.length === 0 || !viewports.every((v) => typeof v === 'number' && v > 0)) {
      throw new ConfigError('viewports must be a non-empty array of positive numbers.');
    }
    config.viewports = viewports as number[];
  }

  if (obj.tolerances !== undefined) {
    const tol = expectObject(obj.tolerances, 'tolerances');
    for (const key of Object.keys(tol)) {
      if (!(key in config.tolerances)) throw new ConfigError(`Unknown tolerance "${key}".`);
    }
    if (tol.positionPx !== undefined) config.tolerances.positionPx = expectNumber(tol.positionPx, 'tolerances.positionPx');
    if (tol.sizePx !== undefined) config.tolerances.sizePx = expectNumber(tol.sizePx, 'tolerances.sizePx');
    if (tol.colorDeltaE !== undefined) config.tolerances.colorDeltaE = expectNumber(tol.colorDeltaE, 'tolerances.colorDeltaE');
    if (tol.fontSizeExact !== undefined) {
      if (typeof tol.fontSizeExact !== 'boolean') throw new ConfigError('tolerances.fontSizeExact must be a boolean.');
      config.tolerances.fontSizeExact = tol.fontSizeExact;
    }
  }

  if (obj.pointers !== undefined) {
    const pointers = expectStringArray(obj.pointers, 'pointers');
    for (const p of pointers) {
      if (!VALID_POINTERS.has(p)) throw new ConfigError(`Unknown pointer type "${p}".`);
    }
    config.pointers = pointers as PointerType[];
  }

  if (obj.matching !== undefined) {
    const matching = expectObject(obj.matching, 'matching');
    if (matching.preferAttribute !== undefined) {
      config.matching.preferAttribute = expectString(matching.preferAttribute, 'matching.preferAttribute');
    }
  }

  if (obj.severityGate !== undefined) {
    const gate = expectString(obj.severityGate, 'severityGate');
    if (!VALID_SEVERITIES.has(gate)) {
      throw new ConfigError(`severityGate must be one of ${[...VALID_SEVERITIES].join(', ')}; got "${gate}".`);
    }
    config.severityGate = gate as DesignQaConfig['severityGate'];
  }

  if (obj.vision !== undefined) {
    const vision = expectObject(obj.vision, 'vision');
    if (vision.enabled !== undefined) {
      if (typeof vision.enabled !== 'boolean') throw new ConfigError('vision.enabled must be a boolean.');
      config.vision.enabled = vision.enabled;
    }
    if (vision.model !== undefined) config.vision.model = expectString(vision.model, 'vision.model');
  }

  return config;
}

/** Load and resolve a config file. Missing file → defaults (the two-URL path). */
export async function loadConfig(path: string, { optional = true } = {}): Promise<DesignQaConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err: unknown) {
    if (optional && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_CONFIG);
    }
    throw new ConfigError(`Cannot read config file "${path}": ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: unknown) {
    throw new ConfigError(`Config file "${path}" is not valid JSON: ${(err as Error).message}`);
  }
  return resolveConfig(raw);
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ConfigError(`${label} must be a string.`);
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new ConfigError(`${label} must be a number.`);
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ConfigError(`${label} must be an array of strings.`);
  }
  return value;
}

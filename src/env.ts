/**
 * Minimal .env loader (no dependency). Node doesn't read .env automatically,
 * so the CLI calls this at startup to pick up FIGMA_TOKEN / ANTHROPIC_API_KEY.
 *
 * Deliberately tiny: KEY=VALUE per line, `#` comments, optional surrounding
 * quotes. Real environment variables always win — values here only fill gaps,
 * so `FIGMA_TOKEN=… design-qa run` still overrides the file.
 */
import { existsSync, readFileSync } from 'node:fs';

export function loadDotenv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Bridge to the ESM QA engine (repo-root `dist/`). This NestJS app is CommonJS,
 * so we use a Function-based dynamic import that TypeScript won't rewrite into
 * require() — that keeps it a real ESM import at runtime. pathToFileURL makes
 * absolute Windows paths importable.
 */
const esmImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

type RunPipelineFn = (opts: Record<string, unknown>) => Promise<any>;
type LoadConfigFn = (configPath?: string) => Promise<any>;

@Injectable()
export class EngineService {
  private mod: { runPipeline: RunPipelineFn; loadConfig: LoadConfigFn } | null = null;

  private engineRoot(): string {
    return process.env.ENGINE_ROOT
      ? path.resolve(process.env.ENGINE_ROOT)
      : path.resolve(process.cwd(), '..');
  }

  private async load() {
    if (this.mod) return this.mod;
    const root = this.engineRoot();
    const toUrl = (f: string) => pathToFileURL(path.join(root, 'dist', f)).href;
    const [pipeline, config] = await Promise.all([esmImport(toUrl('pipeline.js')), esmImport(toUrl('config.js'))]);
    this.mod = { runPipeline: pipeline.runPipeline, loadConfig: config.loadConfig };
    return this.mod;
  }

  async loadConfig(configPath?: string): Promise<any> {
    const p = configPath ?? path.join(this.engineRoot(), 'design-qa.config.json');
    return (await this.load()).loadConfig(p);
  }

  async runPipeline(opts: Record<string, unknown>): Promise<any> {
    return (await this.load()).runPipeline(opts);
  }
}

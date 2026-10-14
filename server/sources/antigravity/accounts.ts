// Descoberta da pasta e contas do Antigravity (~/.gemini/antigravity-cli ou ~/.gemini/antigravity)
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DetectedAccount } from '../../accounts/detect';

export const ANTIGRAVITY_COLOR = '#2563eb'; // Azul característico do Google / Antigravity

export function discoverAntigravityDir(env: NodeJS.ProcessEnv = process.env, home: string = process.env.HOME || ''): string | undefined {
  const custom = env.ANTIGRAVITY_BRAIN_DIR?.trim() || env.ANTIGRAVITY_HOME?.trim();
  if (custom) {
    const dir = resolve(custom);
    if (existsSync(dir)) return dir;
  }
  const defaultCli = join(home, '.gemini', 'antigravity-cli');
  if (existsSync(defaultCli) && statSync(defaultCli).isDirectory()) {
    return defaultCli;
  }
  const defaultDir = join(home, '.gemini', 'antigravity');
  if (existsSync(defaultDir) && statSync(defaultDir).isDirectory()) {
    return defaultDir;
  }
  return undefined;
}

export function detectAntigravityAccount(dir: string): DetectedAccount {
  return {
    id: '.antigravity',
    provider: 'antigravity',
    configDir: dir,
    short: 'A',
    name: 'Antigravity',
    color: ANTIGRAVITY_COLOR,
  };
}

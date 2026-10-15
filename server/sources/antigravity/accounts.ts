import { existsSync, readFileSync, statSync } from 'node:fs';
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

export function detectAntigravityAccount(dir: string, env: NodeJS.ProcessEnv = process.env): DetectedAccount {
  let plan = env.HABBLAUD_ANTIGRAVITY_PLAN?.trim() || env.ANTIGRAVITY_PLAN?.trim();
  let email = env.HABBLAUD_ANTIGRAVITY_EMAIL?.trim() || env.ANTIGRAVITY_EMAIL?.trim();
  let organization = env.HABBLAUD_ANTIGRAVITY_ORG?.trim() || env.ANTIGRAVITY_ORG?.trim();

  if (!plan) {
    const planFiles = [join(dir, 'plan'), join(dir, 'plan.txt')];
    for (const pf of planFiles) {
      if (existsSync(pf)) {
        try {
          const content = readFileSync(pf, 'utf-8').trim();
          if (content) {
            plan = content;
            break;
          }
        } catch {}
      }
    }
  }

  const userJson = join(dir, 'user.json');
  if (existsSync(userJson)) {
    try {
      const data = JSON.parse(readFileSync(userJson, 'utf-8'));
      if (typeof data.plan === 'string' && !plan) plan = data.plan.trim();
      if (typeof data.email === 'string' && !email) email = data.email.trim();
      if (typeof data.organization === 'string' && !organization) organization = data.organization.trim();
    } catch {}
  }

  return {
    id: '.antigravity',
    provider: 'antigravity',
    configDir: dir,
    short: 'A',
    name: 'Antigravity',
    color: ANTIGRAVITY_COLOR,
    ...(plan ? { plan } : {}),
    ...(email ? { email } : {}),
    ...(organization ? { organization } : {}),
  };
}

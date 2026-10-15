// Carregamento de configuração para o AgentSquad a partir de variáveis de ambiente.
import type { AgentSquadConfig } from './types';

export function parseRepoPaths(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    if (raw.startsWith('{')) return JSON.parse(raw);
  } catch {}

  const out: Record<string, string> = {};
  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const [repo, path] = trimmed.split('=');
    if (repo && path) out[repo.trim()] = path.trim();
  }
  return out;
}

export function loadAgentSquadConfig(env: NodeJS.ProcessEnv = process.env): AgentSquadConfig {
  const reposRaw = env.AGENTSQUAD_REPOS || '';
  const repos = reposRaw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  const pollIntervalMs = env.AGENTSQUAD_POLL_MS ? parseInt(env.AGENTSQUAD_POLL_MS, 10) : 10_000;
  const useMockProvider = env.AGENTSQUAD_MOCK === '1' || env.AGENTSQUAD_MOCK === 'true';
  const githubToken = env.AGENTSQUAD_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
  const repoPaths = parseRepoPaths(env.AGENTSQUAD_REPO_PATHS);

  return {
    repos: repos.length > 0 ? repos : ['gihovani/zypa'],
    pollIntervalMs: isNaN(pollIntervalMs) ? 10_000 : pollIntervalMs,
    githubToken,
    repoPaths,
    useMockProvider,
  };
}

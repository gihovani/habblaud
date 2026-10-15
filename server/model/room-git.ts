// Detecção automática de repositório GitHub a partir do caminho da sala.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseGithubRepo } from '../updates/checker';

const cache = new Map<string, { mtime: number; url?: string }>();

/**
 * Inspeciona o diretório `.git` da pasta para detectar se pertence a um repositório GitHub
 * e retorna a URL correspondente (ex: https://github.com/owner/repo).
 */
export function getRoomGithubUrl(folderPath: string): string | undefined {
  if (!folderPath) return undefined;
  try {
    const gitPath = join(folderPath, '.git');
    const stat = statSync(gitPath);
    let configPath = join(gitPath, 'config');
    let mtime = stat.mtimeMs;

    // Se .git for um arquivo (worktree ou submódulo)
    if (!stat.isDirectory()) {
      const content = readFileSync(gitPath, 'utf8');
      const match = /^gitdir:\s*(.+)$/m.exec(content);
      if (!match) return undefined;
      let gitDir = match[1].trim();
      if (!gitDir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(gitDir)) {
        gitDir = join(folderPath, gitDir);
      }
      configPath = join(gitDir, 'config');
      try {
        mtime = statSync(configPath).mtimeMs;
      } catch {
        // Fallback para worktree com configuração compartilhada
        configPath = join(gitDir, '..', '..', 'config');
        mtime = statSync(configPath).mtimeMs;
      }
    }

    const cached = cache.get(folderPath);
    if (cached && cached.mtime === mtime) return cached.url;

    const config = readFileSync(configPath, 'utf8');
    const urlMatch =
      /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\r\n]+)/s.exec(config) ??
      /url\s*=\s*([^\r\n]+github\.com[^\r\n]*)/i.exec(config);

    if (!urlMatch) {
      cache.set(folderPath, { mtime, url: undefined });
      return undefined;
    }

    const repo = parseGithubRepo(urlMatch[1].trim());
    const githubUrl = repo ? `https://github.com/${repo}` : undefined;
    cache.set(folderPath, { mtime, url: githubUrl });
    return githubUrl;
  } catch {
    return undefined;
  }
}

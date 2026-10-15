// Cliente de integração com GitHub via gh CLI e fallback para GitHub REST API.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RawGitHubIssue, RawGitHubPR } from './parser';

const execFileAsync = promisify(execFile);

export type CommandExecutor = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface GitHubClientOptions {
  token?: string;
  executor?: CommandExecutor;
}

export class GitHubClient {
  private readonly token?: string;
  private readonly executor: CommandExecutor;

  constructor(opts: GitHubClientOptions = {}) {
    this.token = opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    this.executor = opts.executor || ((cmd, args) => execFileAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024 }));
  }

  /** Busca issues abertas de um repositório no formato bruto. */
  async fetchOpenIssues(repo: string): Promise<RawGitHubIssue[]> {
    try {
      const { stdout } = await this.executor('gh', [
        'issue',
        'list',
        '--repo',
        repo,
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title,url,labels,body,updatedAt,createdAt,assignees',
      ]);
      const data = JSON.parse(stdout);
      return Array.isArray(data) ? data : [];
    } catch {
      // Fallback para GitHub REST API se gh CLI falhar
      return this.fetchIssuesViaRest(repo);
    }
  }

  /** Busca pull requests abertos de um repositório no formato bruto. */
  async fetchOpenPRs(repo: string): Promise<RawGitHubPR[]> {
    try {
      const { stdout } = await this.executor('gh', [
        'pr',
        'list',
        '--repo',
        repo,
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title,url,labels,headRefName,reviewDecision,closingIssuesReferences,body,createdAt,updatedAt',
      ]);
      const data = JSON.parse(stdout);
      return Array.isArray(data) ? data : [];
    } catch {
      // Fallback para GitHub REST API se gh CLI falhar
      return this.fetchPRsViaRest(repo);
    }
  }

  private async fetchIssuesViaRest(repo: string): Promise<RawGitHubIssue[]> {
    if (!this.token) return [];
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Habblaud-AgentSquad/1.0',
        },
      });
      if (!res.ok) return [];
      const list = (await res.json()) as any[];
      // Filtra PRs (a API de issues do GitHub retorna PRs com o campo pull_request)
      const issuesOnly = list.filter((item) => !item.pull_request);
      return issuesOnly.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        body: i.body || '',
        labels: (i.labels || []).map((l: any) => ({ name: typeof l === 'string' ? l : l.name })),
        assignees: (i.assignees || []).map((a: any) => ({ login: a.login })),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      }));
    } catch {
      return [];
    }
  }

  private async fetchPRsViaRest(repo: string): Promise<RawGitHubPR[]> {
    if (!this.token) return [];
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Habblaud-AgentSquad/1.0',
        },
      });
      if (!res.ok) return [];
      const list = (await res.json()) as any[];
      return list.map((p) => ({
        number: p.number,
        title: p.title,
        url: p.html_url,
        headRefName: p.head?.ref,
        body: p.body || '',
        labels: (p.labels || []).map((l: any) => ({ name: typeof l === 'string' ? l : l.name })),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));
    } catch {
      return [];
    }
  }
}

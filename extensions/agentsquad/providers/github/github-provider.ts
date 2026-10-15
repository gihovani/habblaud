// Provedor de dados do GitHub para o AgentSquad.
import type { SquadProvider } from '../provider';
import type { SquadTask } from '../../types';
import { GitHubClient, type GitHubClientOptions } from './client';
import { parseGitHubTasks } from './parser';

export interface GitHubProviderOptions extends GitHubClientOptions {
  repos: string[];
}

export class GitHubProvider implements SquadProvider {
  readonly name = 'github';
  private readonly repos: string[];
  private readonly client: GitHubClient;
  private cachedTasks: Map<string, SquadTask> = new Map();

  constructor(opts: GitHubProviderOptions) {
    this.repos = opts.repos;
    this.client = new GitHubClient(opts);
  }

  async start(): Promise<void> {
    // Validação inicial
    if (this.repos.length === 0) {
      return;
    }
  }

  stop(): void {
    this.cachedTasks.clear();
  }

  async fetchTasks(): Promise<SquadTask[]> {
    const allTasks: SquadTask[] = [];

    for (const repo of this.repos) {
      try {
        const [issues, prs] = await Promise.all([
          this.client.fetchOpenIssues(repo),
          this.client.fetchOpenPRs(repo),
        ]);
        const tasks = parseGitHubTasks(repo, issues, prs);
        for (const t of tasks) {
          this.cachedTasks.set(t.id, t);
          allTasks.push(t);
        }
      } catch {
        // Se houver falha de rede/CLI, aproveita cache anterior daquele repositório
        for (const t of this.cachedTasks.values()) {
          if (t.repo === repo) allTasks.push(t);
        }
      }
    }

    return allTasks;
  }
}

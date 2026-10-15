// Ponte de sincronização bidirecional entre o AgentSquad e o Office do Habblaud.
import type { Activity, AskQuestion } from '../../../shared/types';
import type { Office } from '../../../server/model/office';
import type { SquadAgent, SquadEvent, SquadTask } from '../types';
import type { SquadEngine } from './squad-engine';

export interface HabblaudBridgeOptions {
  engine: SquadEngine;
  office: Office;
  /** Mapeamento de repositório para pasta no computador (ex: { "gihovani/zypa": "/Users/dev/zypa" }). */
  repoPaths?: Record<string, string>;
  /** Pasta base para repositórios não mapeados. */
  defaultBaseDir?: string;
}

export class HabblaudBridge {
  private readonly engine: SquadEngine;
  private readonly office: Office;
  private readonly repoPaths: Record<string, string>;
  private readonly defaultBaseDir: string;
  private unsubscribe?: () => void;
  private activeAgentIds: Set<string> = new Set();
  private lastActivityMap: Map<string, string> = new Map();

  constructor(opts: HabblaudBridgeOptions) {
    this.engine = opts.engine;
    this.office = opts.office;
    this.repoPaths = opts.repoPaths || {};
    this.defaultBaseDir = opts.defaultBaseDir || (process.env.HOME ? `${process.env.HOME}/projects` : '/projects');
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.on((event) => this.handleEvent(event));
    // Sincroniza estado inicial existente
    this.syncSnapshot(this.engine.getSnapshot().agents, this.engine.getSnapshot().tasks);
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    // Remove agentes mantidos pelo bridge
    for (const agentId of this.activeAgentIds) {
      this.office.closeMain(agentId);
    }
    this.activeAgentIds.clear();
    this.lastActivityMap.clear();
  }

  private handleEvent(event: SquadEvent): void {
    switch (event.type) {
      case 'agent:status_changed':
        this.updateAgentInOffice(event.agent, this.findTask(event.agent.currentTaskId));
        break;
      case 'snapshot:updated':
        this.syncSnapshot(event.snapshot.agents, event.snapshot.tasks);
        break;
    }
  }

  private syncSnapshot(agents: SquadAgent[], tasks: SquadTask[]): void {
    const currentAgentIds = new Set<string>();
    const taskMap = new Map<string, SquadTask>();
    for (const t of tasks) taskMap.set(t.id, t);

    for (const agent of agents) {
      currentAgentIds.add(agent.id);
      this.updateAgentInOffice(agent, agent.currentTaskId ? taskMap.get(agent.currentTaskId) : undefined);
    }

    // Fecha agentes que não estão mais ativos no snapshot
    for (const id of this.activeAgentIds) {
      if (!currentAgentIds.has(id)) {
        this.office.closeMain(id);
        this.activeAgentIds.delete(id);
        this.lastActivityMap.delete(id);
      }
    }
  }

  private updateAgentInOffice(agent: SquadAgent, task?: SquadTask): void {
    const repoPath = this.resolveRepoPath(agent.repo);
    const exists = this.activeAgentIds.has(agent.id);

    if (!exists) {
      this.office.addMain({
        id: agent.id,
        provider: 'antigravity',
        account: `agentsquad:${agent.repo}`,
        sessionId: agent.id,
        cwd: repoPath,
        role: agent.name,
        startedAt: agent.startedAt,
        status: agent.status,
        waitingFor: agent.waitingFor,
      });
      this.activeAgentIds.add(agent.id);
    } else {
      this.office.setStatus(agent.id, agent.status, agent.waitingFor);
    }

    // Se houve mudança de atividade ou de perguntas pendentes, projeta no personagem
    const activityKey = `${agent.status}:${agent.currentActivity}:${task?.pendingQuestions?.length || 0}`;
    if (this.lastActivityMap.get(agent.id) !== activityKey && agent.currentActivity) {
      this.lastActivityMap.set(agent.id, activityKey);

      let questions: AskQuestion[] | undefined;
      if (task?.pendingQuestions && task.pendingQuestions.length > 0) {
        questions = task.pendingQuestions.map((q) => ({
          index: q.index,
          question: q.question,
          options: (q.options || ['Confirmar', 'Ajustar']).map((opt, idx) => ({
            index: idx + 1,
            label: opt,
          })),
        }));
      }

      const activity: Activity = {
        id: `${agent.id}:act:${Date.now()}`,
        kind: agent.isHumanBlocker ? 'ask' : 'other',
        icon: agent.isHumanBlocker ? '❓' : agent.outfit.badgeIcon,
        text: agent.currentActivity.slice(0, 46),
        detail: agent.currentActivity,
        at: Date.now(),
        ...(questions ? { questions } : {}),
      };

      this.office.addActivity(agent.id, activity, true);
    }
  }

  private resolveRepoPath(repo: string): string {
    if (this.repoPaths[repo]) return this.repoPaths[repo];
    // Se repo for "owner/name", usa "name"
    const repoName = repo.includes('/') ? repo.split('/')[1] : repo;
    return `${this.defaultBaseDir}/${repoName}`;
  }

  private findTask(taskId?: string): SquadTask | undefined {
    if (!taskId) return undefined;
    return this.engine.getSnapshot().tasks.find((t) => t.id === taskId);
  }
}

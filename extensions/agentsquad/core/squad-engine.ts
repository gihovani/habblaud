// Motor central do AgentSquad: gerencia ciclo de vida das tarefas, agentes do esquadrão e alertas humanos.
import type {
  AgentRole,
  HumanAlert,
  PipelineStage,
  SquadAgent,
  SquadEvent,
  SquadProvider,
  SquadSnapshot,
  SquadStats,
  SquadTask,
} from '../types';
import {
  computeAgentStatus,
  describeTaskActivity,
  ROLE_METADATA,
  STAGE_ORDER,
} from './state-machine';

export interface SquadEngineOptions {
  providers: SquadProvider[];
  pollIntervalMs?: number;
}

export class SquadEngine {
  private readonly providers: SquadProvider[];
  private readonly pollIntervalMs: number;
  private pollTimer?: NodeJS.Timeout;
  private running = false;

  private tasks: Map<string, SquadTask> = new Map();
  private agents: Map<string, SquadAgent> = new Map();
  private alerts: Map<string, HumanAlert> = new Map();
  private listeners: Set<(event: SquadEvent) => void> = new Set();

  constructor(opts: SquadEngineOptions) {
    this.providers = opts.providers;
    this.pollIntervalMs = opts.pollIntervalMs ?? 10_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const provider of this.providers) {
      await provider.start();
      if (provider.subscribe) {
        provider.subscribe((tasks) => this.applyTasks(tasks));
      }
    }

    // Primeiro sync imediato
    await this.syncNow();

    // Loop de polling
    if (this.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        this.syncNow().catch(() => {});
      }, this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const provider of this.providers) {
      provider.stop();
    }
    this.listeners.clear();
  }

  /** Registra um ouvinte de eventos do motor. */
  on(listener: (event: SquadEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Executa uma sincronização manual e retorna o snapshot atualizado. */
  async syncNow(): Promise<SquadSnapshot> {
    const fetchedTasks: SquadTask[] = [];

    for (const provider of this.providers) {
      try {
        const tasks = await provider.fetchTasks();
        fetchedTasks.push(...tasks);
      } catch {
        // Falha em um provedor não derruba os outros
      }
    }

    this.applyTasks(fetchedTasks);
    return this.getSnapshot();
  }

  /** Atualiza o estado interno com a nova lista de tarefas e dispara eventos. */
  applyTasks(incomingTasks: SquadTask[]): void {
    const incomingMap = new Map<string, SquadTask>();
    for (const t of incomingTasks) incomingMap.set(t.id, t);

    // 1. Processa tarefas novas ou atualizadas
    for (const task of incomingTasks) {
      const existing = this.tasks.get(task.id);

      if (!existing) {
        this.tasks.set(task.id, task);
        this.emit({ type: 'task:created', task });
      } else if (existing.stage !== task.stage || existing.needsHuman !== task.needsHuman || existing.updatedAt !== task.updatedAt) {
        const prevStage = existing.stage;
        this.tasks.set(task.id, task);
        this.emit({ type: 'task:updated', task, prevStage });
      }

      // Trata Alertas Humanos
      if (task.needsHuman) {
        const alertId = `alert:${task.id}`;
        const alert: HumanAlert = {
          id: alertId,
          taskId: task.id,
          repo: task.repo,
          taskTitle: task.title,
          stage: task.stage,
          reason: task.pendingQuestions.length > 0 ? 'question' : 'approval',
          summary: task.pendingQuestions.length > 0
            ? `${task.pendingQuestions.length} dúvida(s) de negócio aguardando resposta humana`
            : `Issue #${task.number} em stage:${task.stage} aguardando aprovação`,
          questions: task.pendingQuestions,
          taskUrl: task.url,
          createdAt: Date.now(),
        };
        this.alerts.set(task.id, alert);
        this.emit({ type: 'alert:human_needed', alert });
      } else if (this.alerts.has(task.id)) {
        this.alerts.delete(task.id);
        this.emit({ type: 'alert:human_resolved', taskId: task.id });
      }
    }

    // 2. Remove tarefas que foram finalizadas ou sumiram do tracker
    for (const [id, existing] of this.tasks.entries()) {
      if (!incomingMap.has(id)) {
        this.tasks.delete(id);
        if (this.alerts.has(id)) {
          this.alerts.delete(id);
          this.emit({ type: 'alert:human_resolved', taskId: id });
        }
        this.emit({ type: 'task:completed', task: existing });
      }
    }

    // 3. Atualiza agentes vivos nos repositórios
    this.reconcileAgents();

    // 4. Emite snapshot completo
    this.emit({ type: 'snapshot:updated', snapshot: this.getSnapshot() });
  }

  /** Retorna o snapshot completo consolidado. */
  getSnapshot(): SquadSnapshot {
    const tasksList = Array.from(this.tasks.values());
    const agentsList = Array.from(this.agents.values());
    const alertsList = Array.from(this.alerts.values());

    const reposSet = new Set<string>();
    for (const t of tasksList) reposSet.add(t.repo);

    const byStage: Record<PipelineStage, number> = {
      inbox: 0,
      refining: 0,
      specifying: 0,
      'awaiting-approval': 0,
      'ready-dev': 0,
      'in-review': 0,
      testing: 0,
      'ready-release': 0,
      done: 0,
    };
    for (const t of tasksList) byStage[t.stage] = (byStage[t.stage] || 0) + 1;

    const byRole: Record<AgentRole, number> = {
      orchestrator: 0,
      refiner: 0,
      'task-master': 0,
      backend: 0,
      frontend: 0,
      devops: 0,
      infra: 0,
      revisor: 0,
      qa: 0,
      'release-manager': 0,
      security: 0,
      human: 0,
    };
    for (const a of agentsList) byRole[a.role] = (byRole[a.role] || 0) + 1;

    const stats: SquadStats = {
      totalActiveTasks: tasksList.length,
      waitingHumanCount: alertsList.length,
      byStage,
      byRole,
    };

    return {
      version: '1.0.0',
      updatedAt: Date.now(),
      repos: Array.from(reposSet),
      tasks: tasksList,
      agents: agentsList,
      alerts: alertsList,
      stats,
    };
  }

  private reconcileAgents(): void {
    // Agrupa tarefas por repo + assignedRole
    const groups = new Map<string, SquadTask[]>();
    for (const task of this.tasks.values()) {
      const key = `${task.repo}:${task.assignedRole}`;
      const list = groups.get(key) || [];
      list.push(task);
      groups.set(key, list);
    }

    const activeKeys = new Set<string>();

    for (const [key, tasks] of groups.entries()) {
      activeKeys.add(key);
      // Prioriza tarefas bloqueadas ou mais recentes
      const currentTask = tasks.find((t) => t.needsHuman) || tasks[0];
      const role = currentTask.assignedRole;
      const outfit = ROLE_METADATA[role] || ROLE_METADATA.orchestrator;
      const status = computeAgentStatus(currentTask.stage, currentTask.needsHuman);
      const activity = describeTaskActivity(role, currentTask.stage, currentTask.title, currentTask.number, currentTask.needsHuman);

      const existing = this.agents.get(key);
      const now = Date.now();

      const agent: SquadAgent = {
        id: `agentsquad:${key}`,
        repo: currentTask.repo,
        role,
        name: outfit.roleTitle,
        status,
        currentTaskId: currentTask.id,
        currentActivity: activity.text,
        waitingFor: activity.waitingFor,
        isHumanBlocker: currentTask.needsHuman,
        startedAt: existing ? existing.startedAt : now,
        lastActiveAt: now,
        outfit,
      };

      this.agents.set(key, agent);
      if (!existing || existing.status !== agent.status || existing.currentActivity !== agent.currentActivity) {
        this.emit({ type: 'agent:status_changed', agent });
      }
    }

    // Remove agentes de funções que não têm mais tarefas ativas
    for (const [key, agent] of this.agents.entries()) {
      if (!activeKeys.has(key)) {
        this.agents.delete(key);
      }
    }
  }

  private emit(event: SquadEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Proteção contra listeners que lançam exceções
      }
    }
  }
}

// Provedor simulado para testes e demonstrações do AgentSquad.
import type { SquadProvider } from '../provider';
import type { PipelineStage, SquadTask } from '../../types';
import { checkNeedsHuman, extractPendingQuestions, resolveAgentRole, STAGE_ORDER } from '../../core/state-machine';

export interface MockTaskInput {
  id: string;
  number: number;
  title: string;
  repo: string;
  stage: PipelineStage;
  labels: string[];
  body?: string;
  branch?: string;
  prNumber?: number;
  prApproved?: boolean;
}

export class MockProvider implements SquadProvider {
  readonly name = 'mock';
  private tasks: Map<string, SquadTask> = new Map();
  private listeners: Set<(tasks: SquadTask[]) => void> = new Set();
  private started = false;

  constructor(initialTasks: MockTaskInput[] = []) {
    for (const t of initialTasks) {
      this.setTask(t);
    }
  }

  async start(): Promise<void> {
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.listeners.clear();
  }

  async fetchTasks(): Promise<SquadTask[]> {
    return Array.from(this.tasks.values());
  }

  subscribe(onTasks: (tasks: SquadTask[]) => void): () => void {
    this.listeners.add(onTasks);
    return () => this.listeners.delete(onTasks);
  }

  /** Adiciona ou atualiza uma tarefa mockada. */
  setTask(input: MockTaskInput): SquadTask {
    const questions = extractPendingQuestions(input.body);
    const needsHuman = checkNeedsHuman(input.stage, input.labels, questions);
    const assignedRole = resolveAgentRole(input.labels, input.stage);

    const task: SquadTask = {
      id: input.id,
      number: input.number,
      title: input.title,
      url: `https://github.com/${input.repo}/issues/${input.number}`,
      repo: input.repo,
      stage: input.stage,
      assignedRole,
      branch: input.branch,
      prNumber: input.prNumber,
      prUrl: input.prNumber ? `https://github.com/${input.repo}/pull/${input.prNumber}` : undefined,
      prApproved: input.prApproved,
      pendingQuestions: questions,
      needsHuman,
      createdAt: Date.now() - 3600_000,
      updatedAt: Date.now(),
      labels: input.labels,
    };

    this.tasks.set(task.id, task);
    this.notify();
    return task;
  }

  /** Remove uma tarefa do mock. */
  removeTask(id: string): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) this.notify();
    return deleted;
  }

  /** Avança uma tarefa para o próximo estágio do pipeline. */
  advanceTask(id: string): SquadTask | undefined {
    const current = this.tasks.get(id);
    if (!current) return undefined;

    const currentIndex = STAGE_ORDER.indexOf(current.stage);
    if (currentIndex < 0 || currentIndex >= STAGE_ORDER.length - 1) return current;

    const nextStage = STAGE_ORDER[currentIndex + 1];
    const newLabels = current.labels.filter((l) => !l.startsWith('stage:') && !l.startsWith('agent:'));
    newLabels.push(`stage:${nextStage}`);

    return this.setTask({
      id: current.id,
      number: current.number,
      title: current.title,
      repo: current.repo,
      stage: nextStage,
      labels: newLabels,
      branch: current.branch,
      prNumber: current.prNumber,
      prApproved: nextStage === 'testing' || nextStage === 'ready-release',
    });
  }

  private notify(): void {
    if (!this.started) return;
    const list = Array.from(this.tasks.values());
    for (const listener of this.listeners) {
      listener(list);
    }
  }
}

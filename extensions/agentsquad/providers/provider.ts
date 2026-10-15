// Contrato base para provedores de tarefas e issues do AgentSquad.
import type { SquadTask } from '../types';

export interface SquadProvider {
  /** Nome identificador do provedor (ex: "github", "mock", "linear"). */
  readonly name: string;

  /** Inicializa o provedor (autenticação, verificação de conexão). */
  start(): Promise<void>;

  /** Encerra watchers ou conexões abertas. */
  stop(): void;

  /** Busca a lista atualizada de tarefas ativas nos repositórios configurados. */
  fetchTasks(): Promise<SquadTask[]>;

  /** Inscrição opcional para eventos push em tempo real (webhooks / websockets). */
  subscribe?(onTasks: (tasks: SquadTask[]) => void): () => void;
}

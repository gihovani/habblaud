// Tipos e modelos de domínio do AgentSquad — Orquestração e Visualização de Squads de Agentes Autônomos.
import type { AgentStatus as HabblaudAgentStatus, Provider as HabblaudProvider } from '../../shared/types';

/** Estágios canônicos do pipeline de desenvolvimento de software autônomo (Momento 1 e Momento 2). */
export type PipelineStage =
  | 'inbox'             // Nova issue criada, aguardando triagem
  | 'refining'          // Refinador (PO/BA) analisando requisitos e BDD
  | 'specifying'        // Task-Master (Tech Lead) detalhando SDD, schemas e contratos
  | 'awaiting-approval' // Alerta Humano: aguardando revisão humana / validação de dúvidas
  | 'ready-dev'         // Aprovado pelo humano, pronto para desenvolvimento
  | 'in-review'         // Pull Request aberto, aguardando Code Review formal do Revisor
  | 'testing'           // PR aprovado pelo Revisor, QA executando testes E2E/Playwright
  | 'ready-release'     // Testes QA aprovados, Release Manager gerando tag/deploy
  | 'done';             // Issue e PR finalizados com sucesso

/** Papéis especializados dos agentes do squad. */
export type AgentRole =
  | 'orchestrator'     // Orquestrador geral do projeto
  | 'refiner'          // Product Owner / Business Analyst (refinamento & BDD)
  | 'task-master'      // Tech Lead (Spec-Driven Design & contratos)
  | 'backend'          // Dev Backend (Node/Fastify/Prisma/PostgreSQL)
  | 'frontend'         // Dev Frontend (Next.js/React/Tailwind/UI)
  | 'ui-engineer'      // Dev Frontend Vanilla / UI responsiva
  | 'devops'           // Engenheiro DevOps (CI/CD, Docker, scripts)
  | 'infra'            // Engenheiro Infraestrutura (Cloud, CDN, SSL)
  | 'revisor'          // Code Reviewer Sênior (revisão de PRs)
  | 'qa'               // Engenheiro QA (E2E, Playwright, Vitest)
  | 'release-manager'  // Release Manager (SemVer, CHANGELOG, deploy)
  | 'security'         // Engenheiro de Segurança & Compliance
  | 'human';           // Operador humano (decisão, desbloqueio ou aprovação)

/** Status visual de trabalho do agente no Habblaud / GG2Land. */
export type SquadAgentStatus = HabblaudAgentStatus; // 'idle' | 'working' | 'waiting' | 'shell' | 'done' | 'offline'

/** Pergunta ou decisão pendente de resposta humana (extraída do body da issue). */
export interface PendingHumanQuestion {
  index: number;
  question: string;
  options?: string[];
}

/** Uma tarefa ou issue ativa no pipeline. */
export interface SquadTask {
  id: string;                      // ex: "1171" ou "ZYPA-1171"
  number: number;                  // ex: 1171
  title: string;                   // Título da tarefa
  url: string;                     // URL no GitHub / rastreador
  repo: string;                    // Repositório (ex: "gihovani/zypa" ou "zypa")
  stage: PipelineStage;            // Estágio atual do pipeline
  assignedRole: AgentRole;         // Agente especialista responsável
  assignedUser?: string;           // Usuário atribuído (se houver)
  branch?: string;                 // Branch de trabalho (ex: "feat/ZYPA-1171-...")
  prNumber?: number;               // PR vinculado (se houver)
  prUrl?: string;                  // URL do PR
  prApproved?: boolean;            // Se o PR já foi aprovado pelo Revisor
  pendingQuestions: PendingHumanQuestion[]; // Perguntas pendentes para o humano
  needsHuman: boolean;             // Se está bloqueado aguardando humano
  createdAt: number;
  updatedAt: number;
  labels: string[];                // Todas as labels brutas
}

/** Alerta de intervenção humana (Human-in-the-Loop). */
export interface HumanAlert {
  id: string;                      // ex: "alert:zypa:1171"
  taskId: string;
  repo: string;
  taskTitle: string;
  stage: PipelineStage;
  reason: 'approval' | 'question' | 'blocker';
  summary: string;
  questions: PendingHumanQuestion[];
  taskUrl: string;
  createdAt: number;
}

/** Um agente vivo alocado no escritório virtual. */
export interface SquadAgent {
  id: string;                      // ex: "agentsquad:zypa:backend"
  repo: string;                    // Repositório associado
  role: AgentRole;                 // Papel do agente
  name: string;                    // Nome amigável (ex: "Dev Backend", "Revisor")
  status: SquadAgentStatus;        // Status de animação
  currentTaskId?: string;          // Tarefa que está executando
  currentActivity?: string;        // Texto de atividade no balão (ex: "Codando rota /api/orders")
  waitingFor?: string;             // O que está esperando (se em status 'waiting')
  isHumanBlocker: boolean;         // Se está com balão de dúvida/alerta humano
  startedAt: number;
  lastActiveAt: number;
  outfit: {
    roleTitle: string;
    badgeIcon: string;             // Emoji/ícone para balão
    themeColor: string;
  };
}

/** Estatísticas de throughput e saúde do pipeline. */
export interface SquadStats {
  totalActiveTasks: number;
  waitingHumanCount: number;
  byStage: Record<PipelineStage, number>;
  byRole: Record<AgentRole, number>;
}

/** Snapshot serializável do AgentSquad (consumido pelo Habblaud e hsb-webview). */
export interface SquadSnapshot {
  version: string;
  updatedAt: number;
  repos: string[];
  tasks: SquadTask[];
  agents: SquadAgent[];
  alerts: HumanAlert[];
  stats: SquadStats;
}

/** Eventos disparados pelo SquadEngine. */
export type SquadEvent =
  | { type: 'task:created'; task: SquadTask }
  | { type: 'task:updated'; task: SquadTask; prevStage?: PipelineStage }
  | { type: 'task:completed'; task: SquadTask }
  | { type: 'alert:human_needed'; alert: HumanAlert }
  | { type: 'alert:human_resolved'; taskId: string }
  | { type: 'agent:status_changed'; agent: SquadAgent }
  | { type: 'snapshot:updated'; snapshot: SquadSnapshot };

export type { SquadProvider } from './providers/provider';

/** Configuração do AgentSquad. */
export interface AgentSquadConfig {
  /** Repositórios a monitorar (ex: ["gihovani/zypa"]). */
  repos: string[];
  /** Intervalo de polling em milissegundos (padrão: 10000 = 10s). */
  pollIntervalMs?: number;
  /** Token de autenticação GitHub (opcional se gh CLI estiver autenticado). */
  githubToken?: string;
  /** Caminho local do repositório no disco para mapeamento de sala no Habblaud (opcional). */
  repoPaths?: Record<string, string>;
  /** Ativar provedor Mock para testes e simulações. */
  useMockProvider?: boolean;
}

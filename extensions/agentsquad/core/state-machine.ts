// Máquina de estados do pipeline autônomo e mapeamento canônico de papéis e atividades.
import type { AgentRole, PendingHumanQuestion, PipelineStage, SquadAgentStatus } from '../types';

/** Metadados visuais de cada papel especializado. */
export const ROLE_METADATA: Record<AgentRole, { roleTitle: string; badgeIcon: string; themeColor: string }> = {
  orchestrator: { roleTitle: 'Orquestrador Geral', badgeIcon: '🧭', themeColor: '#6366f1' },
  refiner: { roleTitle: 'Refinador (PO/BA)', badgeIcon: '🎯', themeColor: '#0ea5e9' },
  'task-master': { roleTitle: 'Task-Master (Tech Lead)', badgeIcon: '📋', themeColor: '#8b5cf6' },
  backend: { roleTitle: 'Dev Backend', badgeIcon: '💻', themeColor: '#10b981' },
  frontend: { roleTitle: 'Dev Frontend', badgeIcon: '🎨', themeColor: '#f59e0b' },
  'ui-engineer': { roleTitle: 'Dev UI Engineer', badgeIcon: '✨', themeColor: '#22d3ee' },
  devops: { roleTitle: 'Engenheiro DevOps', badgeIcon: '⚙️', themeColor: '#64748b' },
  infra: { roleTitle: 'Engenheiro Infra', badgeIcon: '☁️', themeColor: '#0284c7' },
  revisor: { roleTitle: 'Revisor de Código', badgeIcon: '🔍', themeColor: '#ec4899' },
  qa: { roleTitle: 'Engenheiro QA', badgeIcon: '🧪', themeColor: '#14b8a6' },
  'release-manager': { roleTitle: 'Release Manager', badgeIcon: '🚀', themeColor: '#f97316' },
  security: { roleTitle: 'Engenheiro de Segurança', badgeIcon: '🛡️', themeColor: '#ef4444' },
  human: { roleTitle: 'Operador Humano', badgeIcon: '👤', themeColor: '#eab308' },
};

/** Mapeamento de estágio do pipeline para o papel de agente responsável por padrão. */
export const STAGE_DEFAULT_ROLE: Record<PipelineStage, AgentRole> = {
  inbox: 'refiner',
  refining: 'refiner',
  specifying: 'task-master',
  'awaiting-approval': 'human',
  'ready-dev': 'backend',
  'in-review': 'revisor',
  testing: 'qa',
  'ready-release': 'release-manager',
  done: 'orchestrator',
};

/** Ordem cronológica dos estágios para cálculo de progresso. */
export const STAGE_ORDER: PipelineStage[] = [
  'inbox',
  'refining',
  'specifying',
  'awaiting-approval',
  'ready-dev',
  'in-review',
  'testing',
  'ready-release',
  'done',
];

/** Determina se a tarefa requer intervenção humana ativa. */
export function checkNeedsHuman(stage: PipelineStage, labels: string[], pendingQuestions: PendingHumanQuestion[]): boolean {
  if (stage === 'awaiting-approval') return true;
  if (labels.some((l) => l.toLowerCase() === 'agent:human' || l.toLowerCase() === 'stage:awaiting-approval')) return true;
  if (pendingQuestions.length > 0 && stage !== 'done') return true;
  return false;
}

/** Determina o papel do agente a partir das labels ou do estágio do pipeline. */
export function resolveAgentRole(labels: string[], stage: PipelineStage): AgentRole {
  for (const label of labels) {
    const clean = label.toLowerCase().trim();
    if (clean.startsWith('agent:')) {
      const rolePart = clean.replace('agent:', '').trim() as AgentRole;
      if (rolePart in ROLE_METADATA) return rolePart;
    }
    // Suporte a labels diretas utilizadas no Zypa (ex: frontend, backend, infra, devops)
    if (clean in ROLE_METADATA && clean !== 'human') {
      return clean as AgentRole;
    }
  }
  return STAGE_DEFAULT_ROLE[stage] ?? 'orchestrator';
}

/** Determina o estágio do pipeline a partir das labels da issue. */
export function resolvePipelineStage(labels: string[]): PipelineStage {
  for (const label of labels) {
    const clean = label.toLowerCase().trim();
    if (clean.startsWith('stage:')) {
      const stagePart = clean.replace('stage:', '').trim() as PipelineStage;
      if (STAGE_ORDER.includes(stagePart)) return stagePart;
    }
  }
  return 'inbox';
}

/** Calcula o status de visualização do agente (working, waiting, done). */
export function computeAgentStatus(stage: PipelineStage, needsHuman: boolean): SquadAgentStatus {
  if (stage === 'done') return 'done';
  if (needsHuman) return 'waiting';
  return 'working';
}

/** Gera a mensagem de atividade contextual exibida no balão e no feed do Habblaud. */
export function describeTaskActivity(role: AgentRole, stage: PipelineStage, taskTitle: string, taskNumber: number, needsHuman: boolean): { text: string; icon: string; waitingFor?: string } {
  const shortTitle = taskTitle.length > 50 ? `${taskTitle.slice(0, 47)}...` : taskTitle;

  if (needsHuman) {
    return {
      text: `Aguardando você na #${taskNumber}: ${shortTitle}`,
      icon: '❓',
      waitingFor: 'responder dúvida ou aprovar no GitHub',
    };
  }

  switch (stage) {
    case 'inbox':
    case 'refining':
      return {
        text: `Refinando requisitos da #${taskNumber}: ${shortTitle}`,
        icon: '🎯',
      };
    case 'specifying':
      return {
        text: `Especificando SDD & contratos da #${taskNumber}`,
        icon: '📋',
      };
    case 'ready-dev':
      return {
        text: role === 'frontend' ? `Codando interface da #${taskNumber}` : `Codando regras de negócio da #${taskNumber}`,
        icon: role === 'frontend' ? '🎨' : '💻',
      };
    case 'in-review':
      return {
        text: `Inspecionando PR da #${taskNumber} (Code Review)`,
        icon: '🔍',
      };
    case 'testing':
      return {
        text: `Validando testes E2E/Playwright da #${taskNumber}`,
        icon: '🧪',
      };
    case 'ready-release':
      return {
        text: `Gerando release SemVer & deploy da #${taskNumber}`,
        icon: '🚀',
      };
    case 'done':
      return {
        text: `Concluiu tarefa #${taskNumber}`,
        icon: '✅',
      };
    default:
      return {
        text: `Trabalhando na #${taskNumber}`,
        icon: '⚡',
      };
  }
}

/**
 * Extrai perguntas e opções pendentes para o humano do body da issue, seguindo a convenção:
 * ## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
 * 1. Pergunta...
 *    - (a) Opção 1
 *    - (b) Opção 2
 */
export function extractPendingQuestions(body: string | undefined): PendingHumanQuestion[] {
  if (!body) return [];

  const sectionRegex = /##\s*❓\s*Dúvidas\s*&\s*Decisões\s*Pendentes[^\n]*\n([\s\S]*?)(?=\n##|\n---|$)/i;
  const match = body.match(sectionRegex);
  if (!match) return [];

  const sectionText = match[1].trim();
  const questionBlocks = sectionText.split(/(?=\n\d+\.\s+)/);
  const result: PendingHumanQuestion[] = [];

  for (let i = 0; i < questionBlocks.length; i++) {
    const block = questionBlocks[i].trim();
    if (!block) continue;

    const itemMatch = block.match(/^\d+\.\s+([^\n]+)([\s\S]*)$/);
    if (itemMatch) {
      const qText = itemMatch[1].trim();
      const optionsText = itemMatch[2] || '';
      const options = optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('-') || line.startsWith('*'))
        .map((line) => line.replace(/^[-*]\s*/, '').trim());

      result.push({
        index: i + 1,
        question: qText,
        ...(options.length > 0 ? { options } : {}),
      });
    }
  }

  return result;
}

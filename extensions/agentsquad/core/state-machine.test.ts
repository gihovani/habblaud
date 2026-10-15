import { describe, expect, it } from 'vitest';
import {
  checkNeedsHuman,
  computeAgentStatus,
  describeTaskActivity,
  extractPendingQuestions,
  resolveAgentRole,
  resolvePipelineStage,
} from './state-machine';

describe('AgentSquad state-machine', () => {
  it('resolvePipelineStage extrai corretamente o estágio a partir das labels', () => {
    expect(resolvePipelineStage(['stage:in-review', 'bug'])).toBe('in-review');
    expect(resolvePipelineStage(['enhancement', 'stage:ready-dev'])).toBe('ready-dev');
    expect(resolvePipelineStage(['sem-stage'])).toBe('inbox');
  });

  it('resolveAgentRole mapeia a label agent:* ou o papel padrão do estágio', () => {
    expect(resolveAgentRole(['agent:frontend'], 'ready-dev')).toBe('frontend');
    expect(resolveAgentRole(['agent:qa'], 'testing')).toBe('qa');
    expect(resolveAgentRole([], 'inbox')).toBe('refiner');
    expect(resolveAgentRole([], 'specifying')).toBe('task-master');
    expect(resolveAgentRole([], 'in-review')).toBe('revisor');
    expect(resolveAgentRole([], 'ready-release')).toBe('release-manager');
  });

  it('checkNeedsHuman identifica quando a tarefa necessita de intervenção humana', () => {
    expect(checkNeedsHuman('awaiting-approval', [], [])).toBe(true);
    expect(checkNeedsHuman('ready-dev', ['agent:human'], [])).toBe(true);
    expect(checkNeedsHuman('ready-dev', [], [{ index: 1, question: 'Dúvida de negócio' }])).toBe(true);
    expect(checkNeedsHuman('ready-dev', [], [])).toBe(false);
    expect(checkNeedsHuman('done', [], [{ index: 1, question: 'Pergunta antiga' }])).toBe(false);
  });

  it('computeAgentStatus calcula o status visual do agente', () => {
    expect(computeAgentStatus('ready-dev', false)).toBe('working');
    expect(computeAgentStatus('ready-dev', true)).toBe('waiting');
    expect(computeAgentStatus('done', false)).toBe('done');
  });

  it('describeTaskActivity gera mensagens com ícones e textos contextuais', () => {
    const actRefining = describeTaskActivity('refiner', 'refining', 'Criar carrinho de compras', 101, false);
    expect(actRefining.icon).toBe('🎯');
    expect(actRefining.text).toContain('#101');

    const actReview = describeTaskActivity('revisor', 'in-review', 'Adicionar middleware', 102, false);
    expect(actReview.icon).toBe('🔍');
    expect(actReview.text).toContain('Inspecionando PR');

    const actWaiting = describeTaskActivity('human', 'awaiting-approval', 'Decidir regra de comissão', 103, true);
    expect(actWaiting.icon).toBe('❓');
    expect(actWaiting.waitingFor).toBeDefined();
  });

  it('extractPendingQuestions extrai perguntas e opções do padrão de body da issue', () => {
    const body = `
## Descrição
Implementação do cálculo de comissões.

## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Qual percentual padrão quando não definido?
   - (a) 10%
   - (b) 15%
   - (c) Zero
2. Deve gerar notificação por WhatsApp?
   - (a) Sim
   - (b) Não

## Critérios BDD
Dado que...
`;

    const questions = extractPendingQuestions(body);
    expect(questions).toHaveLength(2);
    expect(questions[0].question).toBe('Qual percentual padrão quando não definido?');
    expect(questions[0].options).toEqual(['(a) 10%', '(b) 15%', '(c) Zero']);
    expect(questions[1].question).toBe('Deve gerar notificação por WhatsApp?');
    expect(questions[1].options).toEqual(['(a) Sim', '(b) Não']);
  });
});

import { describe, expect, it } from 'vitest';
import { extractClosingIssuesFromBody, parseGitHubTasks, type RawGitHubIssue, type RawGitHubPR } from './parser';

describe('AgentSquad GitHub parser', () => {
  it('extractClosingIssuesFromBody extrai números com Closes #X e Fixes #Y', () => {
    const body = `
Resumo das alterações.
Closes #1171
Fixes #1172
Mais detalhes no corpo.
`;
    expect(extractClosingIssuesFromBody(body)).toEqual([1171, 1172]);
    expect(extractClosingIssuesFromBody(undefined)).toEqual([]);
  });

  it('parseGitHubTasks converte issues e vincula PRs correspondentes', () => {
    const issues: RawGitHubIssue[] = [
      {
        number: 101,
        title: 'Criar tela de checkout',
        url: 'https://github.com/org/repo/issues/101',
        labels: [{ name: 'stage:ready-dev' }, { name: 'agent:frontend' }],
        createdAt: '2026-10-14T20:00:00Z',
        updatedAt: '2026-10-14T21:00:00Z',
      },
      {
        number: 102,
        title: 'Modelar tabela de pagamentos',
        url: 'https://github.com/org/repo/issues/102',
        body: `
## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Qual o gateway principal?
   - (a) Stripe
   - (b) Pagar.me
`,
        labels: [{ name: 'stage:specifying' }],
        createdAt: '2026-10-14T20:00:00Z',
        updatedAt: '2026-10-14T21:00:00Z',
      },
    ];

    const prs: RawGitHubPR[] = [
      {
        number: 201,
        title: 'feat: checkout screen',
        url: 'https://github.com/org/repo/pull/201',
        headRefName: 'feat/ZYPA-101-checkout',
        reviewDecision: 'APPROVED',
        closingIssuesReferences: [{ number: 101 }],
        createdAt: '2026-10-14T21:30:00Z',
        updatedAt: '2026-10-14T21:35:00Z',
      },
    ];

    const tasks = parseGitHubTasks('org/repo', issues, prs);

    expect(tasks).toHaveLength(2);

    // Issue 101 foi promovida para testing porque o PR está aprovado
    const task1 = tasks.find((t) => t.number === 101)!;
    expect(task1.stage).toBe('testing');
    expect(task1.assignedRole).toBe('frontend');
    expect(task1.prNumber).toBe(201);
    expect(task1.prApproved).toBe(true);
    expect(task1.needsHuman).toBe(false);

    // Issue 102 tem dúvidas pendentes -> needsHuman: true
    const task2 = tasks.find((t) => t.number === 102)!;
    expect(task2.stage).toBe('specifying');
    expect(task2.assignedRole).toBe('task-master');
    expect(task2.needsHuman).toBe(true);
    expect(task2.pendingQuestions).toHaveLength(1);
    expect(task2.pendingQuestions[0].question).toBe('Qual o gateway principal?');
  });
});

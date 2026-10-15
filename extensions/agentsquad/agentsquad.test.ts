import { describe, expect, it } from 'vitest';
import { NameStore } from '../../server/model/names';
import { Office } from '../../server/model/office';
import { createAgentSquad } from './index';
import { MockProvider } from './providers/mock/mock-provider';

describe('AgentSquad Integration Flow (E2E)', () => {
  it('avança uma issue pelo pipeline completo (Momento 1 e 2) com reflexão no Habblaud', async () => {
    const office = new Office({
      names: new NameStore(null),
      version: '1.0.0',
      startedAt: Date.now(),
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
    });

    const mockProvider = new MockProvider([
      {
        id: 'zypa:1200',
        number: 1200,
        title: 'Módulo de Gestão de Comissões',
        repo: 'gihovani/zypa',
        stage: 'inbox',
        labels: ['stage:inbox'],
      },
    ]);

    const squad = createAgentSquad({
      office,
      customProviders: [mockProvider],
      config: {
        repos: ['gihovani/zypa'],
        repoPaths: { 'gihovani/zypa': '/Users/gihovani.demetrio/www/zypa' },
      },
    });

    await squad.start();

    // 1. Estágio: inbox -> Agente Refinador assumindo
    let snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('inbox');
    expect(snap.agents[0].role).toBe('refiner');
    expect(snap.agents[0].status).toBe('working');

    // 2. Refinador conclui e transita para specifying -> Task-Master assume
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'specifying',
      labels: ['stage:specifying', 'agent:task-master'],
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('specifying');
    expect(snap.agents[0].role).toBe('task-master');
    expect(snap.agents[0].status).toBe('working');

    // 3. Task-Master conclui SDD e transita para awaiting-approval -> Alerta Humano
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'awaiting-approval',
      labels: ['stage:awaiting-approval', 'agent:human'],
      body: `
## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Comissão de estorno é deduzida na hora ou na próxima fatura?
   - (a) Na hora
   - (b) Na próxima fatura
`,
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('awaiting-approval');
    expect(snap.tasks[0].needsHuman).toBe(true);
    expect(snap.alerts).toHaveLength(1);
    expect(snap.stats.waitingHumanCount).toBe(1);

    const activeInOffice = office.list().filter((a) => a.status !== 'offline');
    expect(activeInOffice[0].status).toBe('waiting');
    expect(activeInOffice[0].waitingFor).toContain('responder dúvida ou aprovar');

    // 4. Humano responde, aprova e transita para ready-dev -> Dev Backend assume
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'ready-dev',
      labels: ['stage:ready-dev', 'agent:backend'],
      body: 'Decisão aprovada: dedução na hora.',
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('ready-dev');
    expect(snap.tasks[0].needsHuman).toBe(false);
    expect(snap.alerts).toHaveLength(0);
    expect(snap.agents[0].role).toBe('backend');
    expect(snap.agents[0].status).toBe('working');

    // 5. Dev abre PR -> Transita para in-review -> Revisor assume
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'in-review',
      labels: ['stage:in-review', 'agent:revisor'],
      branch: 'feat/ZYPA-1200-comissoes',
      prNumber: 345,
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('in-review');
    expect(snap.agents[0].role).toBe('revisor');
    expect(snap.agents[0].status).toBe('working');

    // 6. Revisor aprova PR -> Transita para testing -> QA assume
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'testing',
      labels: ['stage:testing', 'agent:qa'],
      branch: 'feat/ZYPA-1200-comissoes',
      prNumber: 345,
      prApproved: true,
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('testing');
    expect(snap.agents[0].role).toBe('qa');
    expect(snap.agents[0].status).toBe('working');

    // 7. QA aprova e mergeia PR -> Transita para ready-release -> Release Manager assume
    mockProvider.setTask({
      id: 'zypa:1200',
      number: 1200,
      title: 'Módulo de Gestão de Comissões',
      repo: 'gihovani/zypa',
      stage: 'ready-release',
      labels: ['stage:ready-release', 'agent:release-manager'],
    });

    snap = squad.engine.getSnapshot();
    expect(snap.tasks[0].stage).toBe('ready-release');
    expect(snap.agents[0].role).toBe('release-manager');
    expect(snap.agents[0].status).toBe('working');

    // 8. Release Manager conclui deploy e fecha a issue -> Tarefa concluída
    mockProvider.removeTask('zypa:1200');

    snap = squad.engine.getSnapshot();
    expect(snap.tasks).toHaveLength(0);
    expect(snap.agents).toHaveLength(0);

    // Encerra squad
    squad.stop();
  });
});

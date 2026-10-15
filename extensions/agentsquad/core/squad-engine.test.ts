import { describe, expect, it } from 'vitest';
import { MockProvider } from '../providers/mock/mock-provider';
import { SquadEngine } from './squad-engine';
import type { SquadEvent } from '../types';

describe('AgentSquad SquadEngine', () => {
  it('gerencia tarefas, cria agentes e dispara eventos de ciclo de vida', async () => {
    const provider = new MockProvider([
      {
        id: 'zypa:100',
        number: 100,
        title: 'Modelar checkout',
        repo: 'gihovani/zypa',
        stage: 'specifying',
        labels: ['stage:specifying', 'agent:task-master'],
      },
    ]);

    const engine = new SquadEngine({ providers: [provider], pollIntervalMs: 0 });
    const events: SquadEvent[] = [];
    engine.on((e) => events.push(e));

    await engine.start();

    const snapshot = engine.getSnapshot();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].id).toBe('zypa:100');
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].role).toBe('task-master');
    expect(snapshot.agents[0].status).toBe('working');
    expect(snapshot.stats.totalActiveTasks).toBe(1);
    expect(snapshot.stats.waitingHumanCount).toBe(0);

    engine.stop();
  });

  it('dispara alert:human_needed e atualiza status para waiting quando há dúvidas pendentes', async () => {
    const provider = new MockProvider();
    const engine = new SquadEngine({ providers: [provider], pollIntervalMs: 0 });

    const alertsReceived: string[] = [];
    const resolvedReceived: string[] = [];
    engine.on((e) => {
      if (e.type === 'alert:human_needed') alertsReceived.push(e.alert.taskId);
      if (e.type === 'alert:human_resolved') resolvedReceived.push(e.taskId);
    });

    await engine.start();

    // 1. Cria tarefa com dúvida de negócio
    provider.setTask({
      id: 'zypa:101',
      number: 101,
      title: 'Regra de juros no parcelamento',
      repo: 'gihovani/zypa',
      stage: 'specifying',
      labels: ['stage:specifying'],
      body: `
## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Cobrar juros a partir de qual parcela?
   - (a) 3x
   - (b) 6x
`,
    });

    const snap1 = engine.getSnapshot();
    expect(snap1.alerts).toHaveLength(1);
    expect(snap1.alerts[0].reason).toBe('question');
    expect(snap1.agents[0].status).toBe('waiting');
    expect(snap1.agents[0].waitingFor).toContain('responder dúvida');
    expect(alertsReceived).toEqual(['zypa:101']);

    // 2. Humano responde e remove a seção de dúvidas, passando para ready-dev
    provider.setTask({
      id: 'zypa:101',
      number: 101,
      title: 'Regra de juros no parcelamento',
      repo: 'gihovani/zypa',
      stage: 'ready-dev',
      labels: ['stage:ready-dev', 'agent:backend'],
      body: 'Dúvida respondida: juros a partir de 6x.',
    });

    const snap2 = engine.getSnapshot();
    expect(snap2.alerts).toHaveLength(0);
    expect(snap2.agents[0].status).toBe('working');
    expect(snap2.agents[0].role).toBe('backend');
    expect(resolvedReceived).toEqual(['zypa:101']);

    engine.stop();
  });

  it('remove tarefas concluídas e encerra agentes sem trabalho', async () => {
    const provider = new MockProvider([
      {
        id: 'zypa:102',
        number: 102,
        title: 'Corrigir query lenta',
        repo: 'gihovani/zypa',
        stage: 'ready-dev',
        labels: ['stage:ready-dev'],
      },
    ]);

    const engine = new SquadEngine({ providers: [provider], pollIntervalMs: 0 });
    await engine.start();

    expect(engine.getSnapshot().agents).toHaveLength(1);

    // Remove tarefa (issue fechada no GitHub)
    provider.removeTask('zypa:102');

    const snap = engine.getSnapshot();
    expect(snap.tasks).toHaveLength(0);
    expect(snap.agents).toHaveLength(0);

    engine.stop();
  });
});

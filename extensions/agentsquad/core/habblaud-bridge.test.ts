import { describe, expect, it } from 'vitest';
import { NameStore } from '../../../server/model/names';
import { Office } from '../../../server/model/office';
import { MockProvider } from '../providers/mock/mock-provider';
import { HabblaudBridge } from './habblaud-bridge';
import { SquadEngine } from './squad-engine';

describe('AgentSquad HabblaudBridge', () => {
  it('projeta agentes no Office do Habblaud e reflete mudanças de status e atividade', async () => {
    const office = new Office({
      names: new NameStore(null),
      version: '1.0.0',
      startedAt: Date.now(),
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
    });

    const provider = new MockProvider([
      {
        id: 'zypa:1171',
        number: 1171,
        title: 'Criar webhook de pagamento',
        repo: 'gihovani/zypa',
        stage: 'ready-dev',
        labels: ['stage:ready-dev', 'agent:backend'],
      },
    ]);

    const engine = new SquadEngine({ providers: [provider], pollIntervalMs: 0 });
    const bridge = new HabblaudBridge({
      engine,
      office,
      repoPaths: { 'gihovani/zypa': '/Users/dev/zypa' },
    });

    await engine.start();
    bridge.start();

    // Verifica se o agente foi inserido no Office
    const list1 = office.list();
    expect(list1).toHaveLength(1);
    expect(list1[0].id).toBe('agentsquad:gihovani/zypa:backend');
    expect(office.roomPath(list1[0].roomId)).toBe('/Users/dev/zypa');
    expect(office.roomName(list1[0].roomId)).toBe('zypa');
    expect(list1[0].status).toBe('working');

    // Agora simula uma dúvida humana (trava agent:human)
    provider.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Criar webhook de pagamento',
      repo: 'gihovani/zypa',
      stage: 'specifying',
      labels: ['stage:specifying', 'agent:human'],
      body: `
## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Deve validar HMAC do webhook?
   - (a) Sim, obrigatório
   - (b) Não
`,
    });

    const list2 = office.list().filter((a) => a.status !== 'offline');
    expect(list2).toHaveLength(1);
    expect(list2[0].status).toBe('waiting');
    expect(list2[0].activity?.icon).toBe('❓');
    expect(list2[0].activity?.questions).toHaveLength(1);

    // Encerra bridge e garante que o agente sai do escritório
    bridge.stop();
    engine.stop();

    const list3 = office.list().filter((a) => a.status !== 'offline');
    expect(list3).toHaveLength(0);
  });
});

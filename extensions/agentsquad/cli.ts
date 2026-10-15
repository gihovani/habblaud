// CLI utilitário do AgentSquad para consulta de status e simulação demo.
import { createAgentSquad } from './index';
import { MockProvider } from './providers/mock/mock-provider';

const cmd = process.argv[2] || 'status';

async function main() {
  if (cmd === 'status') {
    const squad = createAgentSquad();
    await squad.start();
    const snap = squad.engine.getSnapshot();
    console.log('\n🧭 === GG2Land AgentSquad Status ===\n');
    console.log(`Versão: ${snap.version}`);
    console.log(`Repositórios: ${snap.repos.join(', ') || 'Nenhum'}`);
    console.log(`Tarefas Ativas: ${snap.stats.totalActiveTasks}`);
    console.log(`Aguardando Humano: ${snap.stats.waitingHumanCount}`);
    console.log('\nAgentes Vivos:');
    if (snap.agents.length === 0) console.log('  (Nenhum agente ativo no momento)');
    for (const a of snap.agents) {
      console.log(`  • [${a.outfit.badgeIcon} ${a.name}] (${a.role}) -> ${a.status.toUpperCase()} | ${a.currentActivity}`);
    }

    if (snap.alerts.length > 0) {
      console.log('\n🚨 Alertas Humanos Pendentes:');
      for (const al of snap.alerts) {
        console.log(`  ❓ [${al.repo}] ${al.taskTitle} -> ${al.summary}`);
      }
    }
    console.log('');
    squad.stop();
    process.exit(0);
  }

  if (cmd === 'demo') {
    console.log('\n🚀 Iniciando Simulação Demo do AgentSquad (Zypa Pipeline)...\n');
    const mock = new MockProvider([
      {
        id: 'zypa:1171',
        number: 1171,
        title: 'Módulo de Gestão de Revenda Consignada',
        repo: 'gihovani/zypa',
        stage: 'inbox',
        labels: ['stage:inbox'],
      },
    ]);

    const squad = createAgentSquad({ customProviders: [mock] });
    await squad.start();

    squad.engine.on((event) => {
      if (event.type === 'agent:status_changed') {
        console.log(`[AgentSquad] 👤 ${event.agent.outfit.badgeIcon} ${event.agent.name}: [${event.agent.status.toUpperCase()}] ${event.agent.currentActivity}`);
      }
      if (event.type === 'alert:human_needed') {
        console.log(`[AgentSquad] 🚨 ALERTA HUMANO: ${event.alert.summary}`);
      }
    });

    console.log('Passo 1: Refinamento iniciado.');
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 2: Avançando para especificação técnica (Tech Lead / Task-Master)...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'specifying',
      labels: ['stage:specifying', 'agent:task-master'],
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 3: Dúvida de negócio encontrada -> Travando em stage:awaiting-approval (Human-in-the-Loop)...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'awaiting-approval',
      labels: ['stage:awaiting-approval', 'agent:human'],
      body: `
## ❓ Dúvidas & Decisões Pendentes (Aguardando Resposta)
1. Comissão de estorno deve ser bloqueada para revendedoras inadimplentes?
   - (a) Sim, bloqueio automático
   - (b) Não, permitir com aviso
`,
    });
    await new Promise((r) => setTimeout(r, 2000));

    console.log('\nPasso 4: Humano respondeu dúvida e aprovou -> Dev Backend assume implementação...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'ready-dev',
      labels: ['stage:ready-dev', 'agent:backend'],
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 5: PR aberto -> Revisor assume Code Review...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'in-review',
      labels: ['stage:in-review', 'agent:revisor'],
      prNumber: 42,
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 6: PR aprovado -> QA valida testes E2E e Playwright...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'testing',
      labels: ['stage:testing', 'agent:qa'],
      prNumber: 42,
      prApproved: true,
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 7: QA aprovado -> Release Manager gerando SemVer e deploy...');
    mock.setTask({
      id: 'zypa:1171',
      number: 1171,
      title: 'Módulo de Gestão de Revenda Consignada',
      repo: 'gihovani/zypa',
      stage: 'ready-release',
      labels: ['stage:ready-release', 'agent:release-manager'],
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\nPasso 8: Deploy finalizado! Issue fechada com sucesso.');
    mock.removeTask('zypa:1171');
    await new Promise((r) => setTimeout(r, 500));

    squad.stop();
    console.log('\n✅ Demonstração do ciclo completo concluída com sucesso!\n');
    process.exit(0);
  }

  console.log('Comando desconhecido. Use: status ou demo');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

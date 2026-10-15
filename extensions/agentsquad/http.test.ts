import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSquadHttpHandler } from './http';
import { createAgentSquad } from './index';
import { MockProvider } from './providers/mock/mock-provider';

describe('AgentSquad HTTP and SSE API', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((ok) => server!.close(() => ok()));
      server = undefined;
    }
  });

  async function startServer() {
    const provider = new MockProvider([
      {
        id: 'zypa:101',
        number: 101,
        title: 'Criar webhook',
        repo: 'gihovani/zypa',
        stage: 'ready-dev',
        labels: ['stage:ready-dev', 'agent:backend'],
      },
    ]);

    const squad = createAgentSquad({ customProviders: [provider] });
    await squad.start();

    const handler = createSquadHttpHandler(squad);

    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!handler(req, res, url.pathname)) {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;

    return {
      base: `http://127.0.0.1:${port}`,
      squad,
      provider,
    };
  }

  it('GET /api/agentsquad/snapshot retorna o snapshot JSON atualizado', async () => {
    const { base, squad } = await startServer();

    const res = await fetch(`${base}/api/agentsquad/snapshot`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.version).toBe('1.0.0');
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('zypa:101');
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].role).toBe('backend');

    squad.stop();
  });

  it('POST /api/agentsquad/sync força sincronização', async () => {
    const { base, squad } = await startServer();

    const res = await fetch(`${base}/api/agentsquad/sync`, { method: 'POST' });
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.snapshot).toBeDefined();

    squad.stop();
  });

  it('GET /api/agentsquad/events transmite SSE em tempo real', async () => {
    const { base, squad, provider } = await startServer();

    const controller = new AbortController();
    const res = await fetch(`${base}/api/agentsquad/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    // Lê primeira mensagem inicial
    const firstChunk = await reader!.read();
    const firstText = new TextDecoder().decode(firstChunk.value);
    expect(firstText).toContain('snapshot:initial');

    // Altera o provedor
    provider.setTask({
      id: 'zypa:102',
      number: 102,
      title: 'Tarefa extra',
      repo: 'gihovani/zypa',
      stage: 'inbox',
      labels: ['stage:inbox'],
    });

    // Lê próximo evento SSE
    const secondChunk = await reader!.read();
    const secondText = new TextDecoder().decode(secondChunk.value);
    expect(secondText).toContain('task:created');

    controller.abort();
    squad.stop();
  });
});

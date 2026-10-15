// Rota dos eventos dos hooks do Antigravity (POST /api/antigravity/events) pelas rotas de verdade (guard e app):
// repassa à fonte do Antigravity ao vivo (um falso) com os 5 eventos suportados, só com Host local, só POST com JSON,
// corpo até 256 KB; sem a fonte ou desligado, {ok: false} ou 404.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import type { AntigravityEvent, AntigravityLive } from '../sources/antigravity/live';
import { tempDir } from '../test/fixtures';
import { request } from '../test/permission-server';
import { parseAntigravityEvent } from './http';

setQuiet(true);

const VALID_EVENT: AntigravityEvent = {
  event: 'PreInvocation',
  conversationId: '0199b0c0-1234-7abc-8def-0123456789ab',
  workspacePaths: ['/Users/dev/project'],
  stepIdx: 1,
};

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(opts: { live?: AntigravityLive; enabled?: boolean } = {}): Promise<{ base: string }> {
  const tmp = tempDir();
  const office = new Office({ names: new NameStore(null), version: 't', startedAt: 0, accounts: () => [], sources: () => [], accountName: () => undefined });
  const hub = new Hub(office, { throttleMs: 10 });
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
  const api = createApiHandler({
    office,
    hub,
    accounts,
    sources: () => [],
    version: 't',
    inDocker: false,
    antigravityEvents: opts.enabled ?? true,
    antigravityLive: opts.live,
  });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  close = () =>
    new Promise((ok) => {
      hub.stop();
      server.closeAllConnections();
      server.close(() => {
        tmp.cleanup();
        ok();
      });
    });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('POST /api/antigravity/events', () => {
  it('repassa o evento à fonte do Antigravity e devolve {ok: true}', async () => {
    const received: AntigravityEvent[] = [];
    const { base } = await serve({
      live: {
        applyHookEvent: (ev) => {
          received.push(ev);
          return true;
        },
      },
    });

    const r = await request(base, '/api/antigravity/events', {
      method: 'POST',
      body: VALID_EVENT,
    });

    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(received).toEqual([VALID_EVENT]);
  });

  it('sem a fonte do Antigravity (ou se ela falha): 200 {ok: false}', async () => {
    let s = await serve();
    expect(await request(s.base, '/api/antigravity/events', { method: 'POST', body: VALID_EVENT })).toMatchObject({ status: 200, json: { ok: false } });
    await close!();

    s = await serve({
      live: {
        applyHookEvent: () => {
          throw new Error('falha interna');
        },
      },
    });
    expect(await request(s.base, '/api/antigravity/events', { method: 'POST', body: VALID_EVENT })).toMatchObject({ status: 200, json: { ok: false } });
  });

  it('quando antigravityEvents está desligado: 404', async () => {
    const { base } = await serve({ enabled: false });
    const r = await request(base, '/api/antigravity/events', { method: 'POST', body: VALID_EVENT });
    expect(r.status).toBe(404);
  });

  it('Host que não é local: 403; GET: 405; sem JSON: 415; corpo inválido: 400; acima de 256 KB: 413', async () => {
    const calls: unknown[] = [];
    const { base } = await serve({ live: { applyHookEvent: (e) => (calls.push(e), true) } });

    for (const host of ['habblaud.lan:4747', '192.168.0.10:4747']) {
      const r = await request(base, '/api/antigravity/events', { method: 'POST', headers: { Host: host }, body: VALID_EVENT });
      expect(r.status, host).toBe(403);
    }

    expect((await request(base, '/api/antigravity/events')).status).toBe(405);
    expect((await request(base, '/api/antigravity/events', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);

    for (const body of [
      {},
      { event: 'UnknownEvent', conversationId: VALID_EVENT.conversationId },
      { event: 'PreInvocation', conversationId: 'not-a-uuid' },
      [],
    ]) {
      expect((await request(base, '/api/antigravity/events', { method: 'POST', body })).status, JSON.stringify(body)).toBe(400);
    }

    const big = { ...VALID_EVENT, tool: { name: 'x', head: 'y'.repeat(300 * 1024) } };
    expect((await request(base, '/api/antigravity/events', { method: 'POST', body: big })).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('parseAntigravityEvent: valida eventos e campos opcionais', () => {
    const parsed = parseAntigravityEvent({
      event: 'PreToolUse',
      conversationId: '0199b0c0-1234-7abc-8def-0123456789ab',
      workspacePaths: ['/a', '/b'],
      stepIdx: 5,
      fullyIdle: true,
      tool: { name: 'run_command', head: 'npm test' },
    });
    expect(parsed).toEqual({
      event: 'PreToolUse',
      conversationId: '0199b0c0-1234-7abc-8def-0123456789ab',
      workspacePaths: ['/a', '/b'],
      stepIdx: 5,
      fullyIdle: true,
      tool: { name: 'run_command', head: 'npm test' },
    });

    expect(() => parseAntigravityEvent(null)).toThrow();
    expect(() => parseAntigravityEvent({ event: 'Invalid', conversationId: '0199b0c0-1234-7abc-8def-0123456789ab' })).toThrow();
    expect(() => parseAntigravityEvent({ event: 'Stop', conversationId: 'invalid' })).toThrow();
  });
});

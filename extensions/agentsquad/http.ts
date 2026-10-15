// Rotas HTTP e SSE do AgentSquad (/api/agentsquad/*) para consumo pelo Habblaud e hsb-webview.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentSquadInstance } from './index';

export function createSquadHttpHandler(squad: AgentSquadInstance) {
  return function handleSquadRoute(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (!path.startsWith('/api/agentsquad/')) return false;

    const method = req.method ?? 'GET';

    // GET /api/agentsquad/snapshot
    if (path === '/api/agentsquad/snapshot') {
      if (method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Método não permitido' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(squad.engine.getSnapshot()));
      return true;
    }

    // POST /api/agentsquad/sync
    if (path === '/api/agentsquad/sync') {
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Método não permitido' }));
        return true;
      }
      squad.engine.syncNow().then(
        (snap) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, snapshot: snap }));
        },
        (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(err) }));
        },
      );
      return true;
    }

    // GET /api/agentsquad/events (Server-Sent Events para hsb-webview)
    if (path === '/api/agentsquad/events') {
      if (method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Método não permitido' }));
        return true;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Manda o snapshot inicial imediatamente
      res.write(`data: ${JSON.stringify({ type: 'snapshot:initial', snapshot: squad.engine.getSnapshot() })}\n\n`);

      const unsubscribe = squad.engine.on((event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on('close', () => {
        unsubscribe();
      });

      return true;
    }

    return false;
  };
}

// Gerenciador de execução do script pipeline-watcher.sh por sala (RoomWatcherManager).
// Permite iniciar, parar, monitorar e transmitir logs do pipeline autônomo via SSE.
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface WatcherStatus {
  available: boolean;
  running: boolean;
  pid?: number;
  startedAt?: number;
  exitCode?: number | null;
}

interface WatcherListener {
  onData: (chunk: string) => void;
  onExit: (code: number | null) => void;
}

interface ActiveWatcher {
  roomId: string;
  folderPath: string;
  process: ChildProcess;
  pid: number;
  startedAt: number;
  exitCode: number | null;
  buffer: string[];
  listeners: Set<WatcherListener>;
}

export const MAX_LOG_LINES = 2000;

export class RoomWatcherManager {
  private watchers = new Map<string, ActiveWatcher>();
  private logHistories = new Map<string, string[]>();

  /** Verifica se a pasta possui o script scripts/pipeline-watcher.sh executável/existente. */
  hasWatcherScript(folderPath?: string): boolean {
    if (!folderPath) return false;
    try {
      const scriptPath = join(folderPath, 'scripts', 'pipeline-watcher.sh');
      return existsSync(scriptPath) && statSync(scriptPath).isFile();
    } catch {
      return false;
    }
  }

  /** Retorna o status atual do watcher para uma sala. */
  getStatus(roomId: string, folderPath?: string): WatcherStatus {
    const active = this.watchers.get(roomId);
    const available = this.hasWatcherScript(folderPath ?? active?.folderPath);

    if (active) {
      return {
        available: true,
        running: true,
        pid: active.pid,
        startedAt: active.startedAt,
        exitCode: active.exitCode,
      };
    }

    return {
      available,
      running: false,
    };
  }

  /** Inicia a execução de scripts/pipeline-watcher.sh na pasta indicada. */
  start(roomId: string, folderPath: string): { ok: boolean; error?: string; status: WatcherStatus } {
    if (!this.hasWatcherScript(folderPath)) {
      return {
        ok: false,
        error: 'O script scripts/pipeline-watcher.sh não foi encontrado neste diretório.',
        status: { available: false, running: false },
      };
    }

    const existing = this.watchers.get(roomId);
    if (existing) {
      return {
        ok: true,
        status: this.getStatus(roomId, folderPath),
      };
    }

    try {
      // Inicia o processo em background
      const child = spawn('bash', ['scripts/pipeline-watcher.sh'], {
        cwd: folderPath,
        env: {
          ...process.env,
          FORCE_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const pid = child.pid;
      if (!pid) {
        return {
          ok: false,
          error: 'Falha ao obter PID do processo.',
          status: { available: true, running: false },
        };
      }

      // Recupera buffer histórico anterior ou inicia novo
      const prevHistory = this.logHistories.get(roomId) ?? [];
      const active: ActiveWatcher = {
        roomId,
        folderPath,
        process: child,
        pid,
        startedAt: Date.now(),
        exitCode: null,
        buffer: prevHistory,
        listeners: new Set(),
      };

      this.watchers.set(roomId, active);

      const appendLog = (text: string) => {
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line && lines.length === 1) continue;
          active.buffer.push(line);
          if (active.buffer.length > MAX_LOG_LINES) {
            active.buffer.shift();
          }
        }
        this.logHistories.set(roomId, active.buffer);

        for (const l of active.listeners) {
          try {
            l.onData(text);
          } catch {
            // Ignora erro em listener desconectado
          }
        }
      };

      child.stdout?.setEncoding('utf-8');
      child.stdout?.on('data', (data: string) => appendLog(data));

      child.stderr?.setEncoding('utf-8');
      child.stderr?.on('data', (data: string) => appendLog(data));

      child.on('error', (err) => {
        appendLog(`\n[HABBLAUD ERRO]: ${err.message}\n`);
      });

      child.on('close', (code) => {
        active.exitCode = code;
        this.watchers.delete(roomId);
        appendLog(`\n[HABBLAUD]: Processo finalizado com código ${code ?? 0}.\n`);

        for (const l of active.listeners) {
          try {
            l.onExit(code);
          } catch {
            // Ignora
          }
        }
        active.listeners.clear();
      });

      return {
        ok: true,
        status: {
          available: true,
          running: true,
          pid,
          startedAt: active.startedAt,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: msg,
        status: { available: true, running: false },
      };
    }
  }

  /** Interrompe o processo ativo do watcher para a sala indicada. */
  stop(roomId: string): { ok: boolean; error?: string } {
    const active = this.watchers.get(roomId);
    if (!active) {
      return { ok: true };
    }

    try {
      active.process.kill('SIGTERM');

      // Se não morrer em 3s, força SIGKILL
      const killTimer = setTimeout(() => {
        try {
          if (this.watchers.has(roomId)) {
            active.process.kill('SIGKILL');
          }
        } catch {
          // Ignora
        }
      }, 3000);

      active.process.once('close', () => {
        clearTimeout(killTimer);
      });

      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  /** Inscreve um ouvinte para receber dados e término do processo. */
  subscribe(roomId: string, listener: WatcherListener): () => void {
    const active = this.watchers.get(roomId);
    if (active) {
      active.listeners.add(listener);
      return () => {
        active.listeners.delete(listener);
      };
    }
    return () => {};
  }

  /** Retorna todo o histórico de logs da sala. */
  getLogs(roomId: string): string {
    const active = this.watchers.get(roomId);
    const buf = active?.buffer ?? this.logHistories.get(roomId) ?? [];
    return buf.join('\n');
  }

  /** Limpa o histórico de logs da sala. */
  clearLogs(roomId: string): void {
    const active = this.watchers.get(roomId);
    if (active) {
      active.buffer = [];
    }
    this.logHistories.delete(roomId);
  }

  /** Encerra todos os processos em execução (para shutdown gracioso do servidor). */
  shutdown(): void {
    for (const [roomId, active] of this.watchers.entries()) {
      try {
        active.process.kill('SIGTERM');
      } catch {
        // Ignora
      }
    }
    this.watchers.clear();
  }
}

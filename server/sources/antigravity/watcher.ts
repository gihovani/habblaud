// Observador de sessões ativas do Antigravity (~/.gemini/antigravity-cli/brain/<uuid>/)
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { AgentStatus } from '../../../shared/types';
import { errMsg, log } from '../../log';
import type { Office } from '../../model/office';
import { FileTail } from '../tail';
import { parseAntigravityJsonlLine } from './parser';
import { tr } from '../../../shared/i18n';

export interface AntigravityWatcherDeps {
  office: Office;
  brainDir: string;
  pollMs?: number;
  maxIdleMs?: number;
  now?: () => number;
}

interface ActiveAntigravitySession {
  sessionId: string;
  cwd: string;
  role: string;
  title?: string;
  startedAt: number;
  lastActivityAt: number;
  tail?: FileTail;
  lineCount: number;
  subagentSeq: number;
  activeSubagents: Map<string, string>; // name -> subId
  stats: {
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    subagents: number;
  };
}

export class AntigravityWatcher {
  private readonly office: Office;
  private readonly brainDir: string;
  private readonly pollMs: number;
  private readonly maxIdleMs: number;
  private readonly now: () => number;
  private active = new Map<string, ActiveAntigravitySession>();
  private timer?: NodeJS.Timeout;
  private fsWatcher?: FSWatcher;
  private running = false;

  constructor(deps: AntigravityWatcherDeps) {
    this.office = deps.office;
    this.brainDir = deps.brainDir;
    this.pollMs = deps.pollMs ?? 2_000;
    this.maxIdleMs = deps.maxIdleMs ?? 45 * 60 * 1_000; // 45 minutos de inatividade
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (!existsSync(this.brainDir)) {
      log.info(tr('Antigravity: diretório brain não encontrado ({0}), aguardando...', [this.brainDir]));
      return;
    }

    this.scan();

    try {
      this.fsWatcher = watch(this.brainDir, () => this.scan());
    } catch (err) {
      log.warn(tr('Antigravity: falha ao criar watcher fs ({0}), usando polling.', [errMsg(err)]));
    }

    this.timer = setInterval(() => this.scan(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {
        // ignora
      }
      this.fsWatcher = undefined;
    }
    this.active.clear();
  }

  sessionCount(): number {
    return this.active.size;
  }

  transcriptPathOf(sessionId: string): string | undefined {
    const candidate = join(this.brainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    return existsSync(candidate) ? candidate : undefined;
  }

  scan(): void {
    if (!existsSync(this.brainDir)) return;

    let entries: string[] = [];
    try {
      entries = readdirSync(this.brainDir);
    } catch (err) {
      log.warn(tr('Antigravity: erro ao listar sessões ({0})', [errMsg(err)]));
      return;
    }

    const now = this.now();
    const currentLiveIds = new Set<string>();

    for (const uuidDir of entries) {
      // Pula arquivos que não sejam pastas de sessões
      if (uuidDir.startsWith('.') || uuidDir.length < 8) continue;

      const sessionDirPath = join(this.brainDir, uuidDir);
      try {
        if (!statSync(sessionDirPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const transcriptPath = join(sessionDirPath, '.system_generated', 'logs', 'transcript.jsonl');
      if (!existsSync(transcriptPath)) continue;

      let fileStat;
      try {
        fileStat = statSync(transcriptPath);
      } catch {
        continue;
      }

      // Sessão considerada viva se modificada dentro do tempo limite
      const idleTime = now - fileStat.mtimeMs;
      if (idleTime > this.maxIdleMs) {
        continue;
      }

      currentLiveIds.add(uuidDir);

      if (this.active.has(uuidDir)) {
        continue; // Já rastreada
      }

      // Nova sessão recente detectada!
      let detectedCwd = '';
      let title: string | undefined;

      // Lê uma amostra inicial do arquivo para descobrir CWD e título
      try {
        const sampleLines = readFileSync(transcriptPath, 'utf8').split('\n').slice(0, 30);
        for (const line of sampleLines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === 'USER_INPUT' && !title) {
              const content = typeof parsed.content === 'string' ? parsed.content : '';
              const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(content);
              const raw = match ? match[1].trim() : content;
              title = raw.replace(/\n+/g, ' ').slice(0, 60);
            }
            if (parsed.type === 'PLANNER_RESPONSE' && Array.isArray(parsed.tool_calls)) {
              for (const tc of parsed.tool_calls) {
                const args = tc.args || {};
                let cwd = typeof args.Cwd === 'string' ? args.Cwd.trim() : '';
                if (cwd.startsWith('"') && cwd.endsWith('"')) cwd = cwd.slice(1, -1);
                if (cwd) {
                  if (!detectedCwd || (detectedCwd.endsWith('/www') && cwd.startsWith(detectedCwd) && cwd !== detectedCwd)) {
                    detectedCwd = cwd;
                  }
                }

                let target = typeof args.TargetFile === 'string' ? args.TargetFile : (typeof args.AbsolutePath === 'string' ? args.AbsolutePath : '');
                if (target.startsWith('"') && target.endsWith('"')) target = target.slice(1, -1);
                if (target.includes('/www/zypa')) {
                  detectedCwd = '/Users/gihovani.demetrio/www/zypa';
                }
              }
            }
          } catch {
            // ignora linha mal formatada
          }
        }
      } catch {
        // ignora
      }

      // Se ainda não detectou o Cwd ou se caiu na raiz genérica /www, verifica arquivos no brain
      if (!detectedCwd || detectedCwd.endsWith('/www')) {
        try {
          const filesInBrain = readdirSync(sessionDirPath);
          const hasZypa = filesInBrain.some((f) => f.toLowerCase().includes('zypa'));
          if (hasZypa) {
            detectedCwd = '/Users/gihovani.demetrio/www/zypa';
          } else if (!detectedCwd) {
            detectedCwd = '/Users/gihovani.demetrio/www';
          }
        } catch {
          if (!detectedCwd) detectedCwd = '/Users/gihovani.demetrio/www';
        }
      }

      const startedAt = fileStat.birthtimeMs || fileStat.ctimeMs || now;

      const sessionObj: ActiveAntigravitySession = {
        sessionId: uuidDir,
        cwd: detectedCwd,
        role: 'Orquestrador Antigravity',
        title,
        startedAt,
        lastActivityAt: fileStat.mtimeMs,
        lineCount: 0,
        subagentSeq: 0,
        activeSubagents: new Map(),
        stats: {
          toolCalls: 0,
          tokensIn: 0,
          tokensOut: 0,
          subagents: 0,
        },
      };

      this.active.set(uuidDir, sessionObj);

      // Adiciona o agente principal ao Habblaud Office
      this.office.addMain({
        id: uuidDir,
        provider: 'antigravity',
        account: '.antigravity',
        sessionId: uuidDir,
        cwd: detectedCwd,
        role: 'Orquestrador Antigravity',
        startedAt,
        status: 'working',
      });

      if (title) {
        this.office.applyTranscript(uuidDir, {
          title,
          tasks: [],
          stats: sessionObj.stats,
        });
      }

      sessionObj.tail = new FileTail(transcriptPath);
    }

    // Processa novas linhas dos tails ativos
    for (const session of this.active.values()) {
      if (!session.tail) continue;
      let res = session.tail.read();
      while (res.lines.length > 0) {
        for (const line of res.lines) {
          session.lineCount++;
          const parsed = parseAntigravityJsonlLine(line, session.lineCount, now);
          if (!parsed) continue;

          session.lastActivityAt = now;

          // Se veio nova lista de atividades
          if (parsed.activities && parsed.activities.length > 0) {
            for (const act of parsed.activities) {
              this.office.addActivity(session.sessionId, act, true, { feed: true });
            }
          } else if (parsed.activity) {
            this.office.addActivity(session.sessionId, parsed.activity, true, { feed: true });
          }

          // Se detectou subagentes invocados
          if (parsed.subagents && parsed.subagents.length > 0) {
            for (const sub of parsed.subagents) {
              const subId = `${session.sessionId}#sub:${sub.name}:${++session.subagentSeq}`;
              session.activeSubagents.set(sub.name, subId);
              session.stats.subagents++;

              this.office.addSub({
                id: subId,
                parentId: session.sessionId,
                sessionId: session.sessionId,
                role: sub.role,
                title: sub.prompt ? sub.prompt.slice(0, 80) : undefined,
                background: true,
                startedAt: now,
              });
            }
          }

          // Atualiza status do agente
          if (parsed.status) {
            this.office.setStatus(session.sessionId, parsed.status, parsed.waitingFor);
          }

          // Atualiza estatísticas acumuladas
          if (parsed.statsDelta) {
            session.stats.toolCalls += parsed.statsDelta.toolCalls;
            session.stats.tokensIn += parsed.statsDelta.tokensIn;
            session.stats.tokensOut += parsed.statsDelta.tokensOut;

            this.office.applyTranscript(session.sessionId, {
              title: session.title,
              tasks: [],
              stats: session.stats,
            });
          }
        }
        if (!res.more) break;
        res = session.tail.read();
      }
    }

    // Encerrar sessões que não estão mais dentro da janela de atividade
    for (const [id, session] of this.active.entries()) {
      if (!currentLiveIds.has(id) || (now - session.lastActivityAt > this.maxIdleMs)) {
        // Encerra subagentes pendentes
        for (const subId of session.activeSubagents.values()) {
          this.office.completeSub(subId);
        }
        this.active.delete(id);
        this.office.closeMain(id);
      }
    }
  }
}

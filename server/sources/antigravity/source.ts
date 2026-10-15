// Fonte de agentes do Antigravity (AgentSource 'antigravity', ver sources/source.ts)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider, SourceInfo } from '../../../shared/types';
import type { AccountsService } from '../../accounts/service';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import type { TerminalParser } from '../terminal';
import { detectAntigravityAccount, discoverAntigravityDir } from './accounts';
import { describeAntigravityTool } from './activity';
import type { AntigravityEvent, AntigravityLive } from './live';
import { AntigravityTerminalParser } from './terminal';
import { AntigravityWatcher } from './watcher';

export interface AntigravitySourceOptions {
  accounts: AccountsService;
  office: Office;
  dir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  pollMs?: number;
}

export class AntigravitySource implements AgentSource, AntigravityLive {
  readonly provider: Provider = 'antigravity';
  private readonly accounts: AccountsService;
  private readonly office: Office;
  private readonly dir: string;
  private readonly brainDir: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly watcher: AntigravityWatcher;

  constructor(opts: AntigravitySourceOptions) {
    this.accounts = opts.accounts;
    this.office = opts.office;
    this.env = opts.env;
    const baseDir = opts.dir ?? discoverAntigravityDir(opts.env, opts.home) ?? join(process.env.HOME || '', '.gemini', 'antigravity-cli');
    this.dir = baseDir;

    // As sessões ficam em <baseDir>/brain
    this.brainDir = join(baseDir, 'brain');
    this.watcher = new AntigravityWatcher({
      office: this.office,
      brainDir: this.brainDir,
      pollMs: opts.pollMs,
    });
  }

  start(): void {
    if (existsSync(this.dir)) {
      this.accounts.setProviderAccounts('antigravity', [
        {
          dir: this.dir,
          detected: detectAntigravityAccount(this.dir, this.env),
        },
      ]);
    }

    this.watcher.start();
  }

  stop(): void {
    this.watcher.stop();
  }

  sources(): SourceInfo[] {
    return [
      {
        label: '.antigravity',
        provider: 'antigravity',
        path: this.dir,
        sessions: this.watcher.sessionCount(),
        ok: existsSync(this.dir),
      },
    ];
  }

  transcriptPathOf(agentId: string): string | undefined {
    return this.watcher.transcriptPathOf(agentId);
  }

  terminalParser(agentId: string): TerminalParser | undefined {
    return new AntigravityTerminalParser();
  }

  /**
   * Recebe os eventos ao vivo disparados pelo hook (POST /api/antigravity/events).
   * Atualiza o estado/atividade no escritório instantaneamente e aciona o scanner da sessão.
   */
  applyHookEvent(event: AntigravityEvent): boolean {
    const key = event.conversationId;
    const now = Date.now();

    // 1. Notifica o watcher imediatamente para escanear novos logs
    this.watcher.scan();

    // 2. Se o agente já está no escritório, atualiza o status/atividade instantaneamente
    if (this.office.has(key)) {
      if (event.event === 'Stop') {
        this.office.setStatus(key, event.fullyIdle === false ? 'working' : 'idle');
        return true;
      }

      this.office.setStatus(key, 'working');
      if (event.event === 'PreToolUse' && event.tool?.name) {
        const { desc, tool } = describeAntigravityTool(event.tool.name, event.tool.head);
        const step = Number.isInteger(event.stepIdx) ? String(event.stepIdx) : event.tool.name;
        const id = `agy-hook-${key}#${step}`;
        this.office.addActivity(key, { id, at: now, ...desc, tool }, true);
      }
      return true;
    }

    // 3. Se ainda não estava no escritório, mas veio com workspace, adiciona
    const cwd = (Array.isArray(event.workspacePaths) ? event.workspacePaths : []).find((p) => typeof p === 'string' && p.trim())?.trim();
    if (cwd) {
      const status = event.event === 'Stop' && event.fullyIdle !== false ? 'idle' : 'working';
      this.office.addMain({
        id: key,
        provider: 'antigravity',
        account: '.antigravity',
        sessionId: key,
        cwd,
        role: 'Orquestrador Antigravity',
        startedAt: now,
        status,
      });
      if (event.event === 'PreToolUse' && event.tool?.name) {
        const { desc, tool } = describeAntigravityTool(event.tool.name, event.tool.head);
        const step = Number.isInteger(event.stepIdx) ? String(event.stepIdx) : event.tool.name;
        const id = `agy-hook-${key}#${step}`;
        this.office.addActivity(key, { id, at: now, ...desc, tool }, true);
      }
      return true;
    }

    return true;
  }
}

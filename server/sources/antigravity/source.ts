// Fonte de agentes do Antigravity (AgentSource 'antigravity', ver sources/source.ts)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider, SourceInfo } from '../../../shared/types';
import type { AccountsService } from '../../accounts/service';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import type { TerminalParser } from '../terminal';
import { detectAntigravityAccount, discoverAntigravityDir } from './accounts';
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

export class AntigravitySource implements AgentSource {
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
}

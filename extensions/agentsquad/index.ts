// Ponto de entrada do AgentSquad — Orquestração e Visualização de Squads de Agentes Autônomos.
import type { Office } from '../../server/model/office';
import { loadAgentSquadConfig } from './config';
import { HabblaudBridge } from './core/habblaud-bridge';
import { SquadEngine } from './core/squad-engine';
import { GitHubProvider } from './providers/github/github-provider';
import { MockProvider } from './providers/mock/mock-provider';
import type { AgentSquadConfig, SquadProvider } from './types';

export * from './types';
export * from './core/state-machine';
export * from './core/squad-engine';
export * from './core/habblaud-bridge';
export * from './providers/provider';
export * from './providers/github/github-provider';
export * from './providers/github/parser';
export * from './providers/github/client';
export * from './providers/mock/mock-provider';
export * from './http';
export * from './config';

export interface CreateAgentSquadOptions {
  config?: Partial<AgentSquadConfig>;
  office?: Office;
  customProviders?: SquadProvider[];
}

export interface AgentSquadInstance {
  engine: SquadEngine;
  bridge?: HabblaudBridge;
  start(): Promise<void>;
  stop(): void;
}

/** Cria e inicializa uma instância do AgentSquad conectado ou não ao Habblaud. */
export function createAgentSquad(opts: CreateAgentSquadOptions = {}): AgentSquadInstance {
  const baseConfig = loadAgentSquadConfig();
  const config: AgentSquadConfig = { ...baseConfig, ...opts.config };

  const providers: SquadProvider[] = opts.customProviders || [];

  if (providers.length === 0) {
    if (config.useMockProvider) {
      providers.push(new MockProvider());
    } else {
      providers.push(
        new GitHubProvider({
          repos: config.repos,
          token: config.githubToken,
        }),
      );
    }
  }

  const engine = new SquadEngine({
    providers,
    pollIntervalMs: config.pollIntervalMs,
  });

  let bridge: HabblaudBridge | undefined;
  if (opts.office) {
    bridge = new HabblaudBridge({
      engine,
      office: opts.office,
      repoPaths: config.repoPaths,
    });
  }

  return {
    engine,
    bridge,
    async start() {
      await engine.start();
      bridge?.start();
    },
    stop() {
      bridge?.stop();
      engine.stop();
    },
  };
}

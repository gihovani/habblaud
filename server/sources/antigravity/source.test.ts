import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAntigravityAccount, discoverAntigravityDir } from './accounts';
import { describeAntigravityTool, parseAntigravityJsonlLine } from './parser';
import { AntigravityWatcher } from './watcher';
import { Office } from '../../model/office';
import { NameStore } from '../../model/names';

describe('Antigravity accounts', () => {
  it('detecta conta com id, provider e cor oficial', () => {
    const acc = detectAntigravityAccount('/mock/dir');
    expect(acc.id).toBe('.antigravity');
    expect(acc.provider).toBe('antigravity');
    expect(acc.name).toBe('Antigravity');
    expect(acc.short).toBe('A');
    expect(acc.color).toBe('#2563eb');
  });

  it('descobre diretório via variável de ambiente ANTIGRAVITY_BRAIN_DIR', () => {
    const tmp = join(tmpdir(), `agy-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      const found = discoverAntigravityDir({ ANTIGRAVITY_BRAIN_DIR: tmp });
      expect(found).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Antigravity parser', () => {
  it('descreve comandos shell com vitest/git/build', () => {
    const testDesc = describeAntigravityTool('run_command', { CommandLine: 'npx vitest run tests/unit' });
    expect(testDesc.kind).toBe('test');
    expect(testDesc.icon).toBe('🧪');

    const gitDesc = describeAntigravityTool('run_command', { CommandLine: 'git status' });
    expect(gitDesc.kind).toBe('git');
    expect(gitDesc.icon).toBe('🌿');

    const buildDesc = describeAntigravityTool('run_command', { CommandLine: 'npm run build' });
    expect(buildDesc.kind).toBe('run');
    expect(buildDesc.icon).toBe('🏗️');
  });

  it('descreve leitura e edição de arquivos', () => {
    const readDesc = describeAntigravityTool('view_file', { AbsolutePath: '/Users/test/zypa/api/src/index.ts' });
    expect(readDesc.kind).toBe('read');
    expect(readDesc.text).toContain('index.ts');

    const editDesc = describeAntigravityTool('replace_file_content', { TargetFile: '/Users/test/zypa/web/page.tsx' });
    expect(editDesc.kind).toBe('edit');
    expect(editDesc.text).toContain('page.tsx');
  });

  it('descreve delegação para subagentes', () => {
    const subDesc = describeAntigravityTool('invoke_subagent', { toolSummary: 'Invocando backend' });
    expect(subDesc.kind).toBe('delegate');
    expect(subDesc.icon).toBe('🤝');
  });

  it('parseia linha USER_INPUT extraindo prompt', () => {
    const line = JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: '<USER_REQUEST>\nImplementar sala do Zypa\n</USER_REQUEST>',
    });

    const parsed = parseAntigravityJsonlLine(line, 1, 1000);
    expect(parsed?.status).toBe('working');
    expect(parsed?.activity?.kind).toBe('prompt');
    expect(parsed?.activity?.detail).toContain('Implementar sala do Zypa');
  });

  it('parseia linha PLANNER_RESPONSE com tool_calls e detecta subagentes e cwd', () => {
    const line = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      input_tokens: 1500,
      output_tokens: 250,
      tool_calls: [
        {
          name: 'run_command',
          args: {
            CommandLine: 'git status',
            Cwd: '/Users/gihovani.demetrio/www/zypa',
            toolSummary: 'Verificando git status',
          },
        },
        {
          name: 'invoke_subagent',
          args: {
            toolSummary: 'Invocando backend',
            Subagents: [
              {
                TypeName: 'backend',
                Role: 'Backend Developer',
                Prompt: 'Implementar rotas',
              },
            ],
          },
        },
      ],
    });

    const parsed = parseAntigravityJsonlLine(line, 2, 2000);
    expect(parsed?.status).toBe('working');
    expect(parsed?.cwd).toBe('/Users/gihovani.demetrio/www/zypa');
    expect(parsed?.subagents).toHaveLength(1);
    expect(parsed?.subagents?.[0]?.name).toBe('backend');
    expect(parsed?.subagents?.[0]?.role).toBe('Backend Developer');
    expect(parsed?.statsDelta?.toolCalls).toBe(2);
    expect(parsed?.statsDelta?.tokensIn).toBe(1500);
  });

  it('parseia linha PLANNER_RESPONSE com ask_question alterando status para waiting', () => {
    const line = JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        {
          name: 'ask_question',
          args: {
            toolSummary: 'Pergunta de confirmação',
          },
        },
      ],
    });

    const parsed = parseAntigravityJsonlLine(line, 3, 3000);
    expect(parsed?.status).toBe('waiting');
    expect(parsed?.waitingFor).toContain('responder');
  });

  it('parseia resposta final de texto alterando status para idle', () => {
    const line = JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Tudo pronto! Todas as etapas foram concluídas com sucesso.',
    });

    const parsed = parseAntigravityJsonlLine(line, 4, 4000);
    expect(parsed?.status).toBe('idle');
    expect(parsed?.activity?.kind).toBe('respond');
  });
});

describe('AntigravityWatcher integration', () => {
  it('registra agente e subagente no Office ao ler diretório de sessão', () => {
    const tmpBase = join(tmpdir(), `agy-watch-test-${Date.now()}`);
    const brainDir = join(tmpBase, 'brain');
    const sessionId = 'test-session-1234';
    const logDir = join(brainDir, sessionId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });

    const transcriptFile = join(logDir, 'transcript.jsonl');
    const line1 = JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Testar integração</USER_REQUEST>',
    });
    const line2 = JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        {
          name: 'run_command',
          args: {
            CommandLine: 'ls -la',
            Cwd: '/Users/gihovani.demetrio/www/zypa',
            toolSummary: 'Listando arquivos',
          },
        },
      ],
    });
    writeFileSync(transcriptFile, `${line1}\n${line2}\n`);

    const names = new NameStore(join(tmpBase, 'names.json'));
    names.load();
    const office = new Office({
      names,
      version: '0.11.0',
      startedAt: Date.now(),
      accounts: () => [],
      sources: () => [],
      accountName: () => 'Antigravity',
    });

    const watcher = new AntigravityWatcher({
      office,
      brainDir,
      pollMs: 100,
      maxIdleMs: 60_000,
      now: () => Date.now(),
    });

    try {
      watcher.scan();
      const agents = office.list();
      expect(agents.some((a) => a.id === sessionId)).toBe(true);
      const agent = agents.find((a) => a.id === sessionId);
      expect(agent?.provider).toBe('antigravity');
      expect(agent?.roomId).toBe('/Users/gihovani.demetrio/www/zypa');
    } finally {
      watcher.stop();
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

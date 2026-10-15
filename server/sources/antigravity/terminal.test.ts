import { describe, expect, it } from 'vitest';
import { AntigravityTerminalParser } from './terminal';

describe('AntigravityTerminalParser', () => {
  it('converte evento USER_INPUT em entrada user limpando metadados', () => {
    const parser = new AntigravityTerminalParser();
    const line = JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      created_at: '2026-10-14T20:00:00.000Z',
      content: '<USER_REQUEST>\nCriar um novo componente\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ninfo\n</ADDITIONAL_METADATA>',
    });

    const entries = parser.push(line);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('user');
    if (entries[0].kind === 'user') {
      expect(entries[0].text).toBe('Criar um novo componente');
      expect(entries[0].at).toBe(Date.parse('2026-10-14T20:00:00.000Z'));
    }
  });

  it('converte evento PLANNER_RESPONSE com thinking e tool_calls', () => {
    const parser = new AntigravityTerminalParser();
    const line = JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      created_at: '2026-10-14T20:00:05.000Z',
      thinking: 'Analisando a estrutura do projeto...',
      content: 'Vou listar os arquivos primeiro.',
      tool_calls: [
        {
          name: 'run_command',
          args: {
            CommandLine: 'ls -la',
            Cwd: '/Users/test/project',
          },
        },
      ],
    });

    const entries = parser.push(line);
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe('thinking');
    if (entries[0].kind === 'thinking') {
      expect(entries[0].text).toContain('Analisando a estrutura');
    }

    expect(entries[1].kind).toBe('tool');
    if (entries[1].kind === 'tool') {
      expect(entries[1].tool).toBe('run_command');
      expect(entries[1].title).toBe('Bash(ls -la)');
    }

    expect(entries[2].kind).toBe('assistant');
    if (entries[2].kind === 'assistant') {
      expect(entries[2].text).toBe('Vou listar os arquivos primeiro.');
    }
  });

  it('converte evento GENERIC em resultado de ferramenta mascarando segredos', () => {
    const parser = new AntigravityTerminalParser();
    const line = JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      created_at: '2026-10-14T20:00:10.000Z',
      content: 'total 0\ndrwxr-xr-x  2 user  staff  64 Oct 14 20:00 src\n',
    });

    const entries = parser.push(line);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('result');
    if (entries[0].kind === 'result') {
      expect(entries[0].text).toContain('src');
    }
  });

  it('ignora linhas vazias ou JSON inválido', () => {
    const parser = new AntigravityTerminalParser();
    expect(parser.push('')).toEqual([]);
    expect(parser.push('not a json')).toEqual([]);
  });
});

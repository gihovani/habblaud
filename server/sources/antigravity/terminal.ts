// Terminal do Antigravity: converte as linhas do transcript JSONL (~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl)
// em TerminalEntry (prompts, respostas, pensamentos e chamadas de ferramentas).
import type { TerminalEntry, TerminalInputKind } from '../../../shared/types';
import { maskSecrets } from '../../../shared/activity';
import { prepare, RESULT_MAX, RESULT_MAX_LINES, TEXT_MAX, THINKING_MAX, toolView, type TerminalParser } from '../terminal';

function cleanPromptText(raw: string): string {
  if (!raw) return '';
  const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(raw);
  const text = match ? match[1].trim() : raw.trim();
  return text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
}

function unquote(val: unknown): string {
  if (typeof val !== 'string') return '';
  let s = val.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export class AntigravityTerminalParser implements TerminalParser {
  private count = 0;

  push(line: string): TerminalEntry[] {
    if (!line || !line.trim()) return [];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [];
    }

    const type = parsed.type as string;
    const createdAt = typeof parsed.created_at === 'string' ? Date.parse(parsed.created_at) || Date.now() : Date.now();
    const entries: TerminalEntry[] = [];

    if (type === 'USER_INPUT') {
      const rawContent = typeof parsed.content === 'string' ? parsed.content : '';
      const text = cleanPromptText(rawContent);
      if (text) {
        this.count++;
        const prep = prepare(text, TEXT_MAX);
        entries.push({
          id: `agy-term-prompt-${this.count}`,
          kind: 'user',
          text: prep.text,
          at: createdAt,
        });
      }
    } else if (type === 'PLANNER_RESPONSE') {
      // 1. Pensamento do agente (thinking)
      if (typeof parsed.thinking === 'string' && parsed.thinking.trim()) {
        this.count++;
        const prep = prepare(parsed.thinking.trim(), THINKING_MAX);
        entries.push({
          id: `agy-term-think-${this.count}`,
          kind: 'thinking',
          text: prep.text,
          at: createdAt,
        });
      }

      // 2. Chamadas de ferramentas (tool_calls)
      if (Array.isArray(parsed.tool_calls)) {
        for (const call of parsed.tool_calls) {
          if (!call || typeof call !== 'object') continue;
          const toolName = typeof call.name === 'string' ? call.name : 'tool';
          const rawArgs = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;

          // Limpa argumentos com aspas aninhadas
          const cleanedArgs: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawArgs)) {
            cleanedArgs[k] = typeof v === 'string' ? unquote(v) : v;
          }

          let title = toolName;
          let input: string | undefined;
          let inputKind: TerminalInputKind | undefined;

          if (toolName === 'run_command') {
            const cmd = typeof cleanedArgs.CommandLine === 'string' ? cleanedArgs.CommandLine : '';
            title = `Bash(${cmd.slice(0, 80)}${cmd.length > 80 ? '…' : ''})`;
            input = cmd;
            inputKind = 'text';
          } else if (toolName === 'view_file') {
            const path = typeof cleanedArgs.AbsolutePath === 'string' ? cleanedArgs.AbsolutePath : '';
            const base = path.split('/').pop() || path;
            title = `View(${base})`;
            input = path;
            inputKind = 'text';
          } else if (toolName === 'write_to_file') {
            const path = typeof cleanedArgs.TargetFile === 'string' ? cleanedArgs.TargetFile : '';
            const base = path.split('/').pop() || path;
            title = `Write(${base})`;
            input = typeof cleanedArgs.CodeContent === 'string' ? cleanedArgs.CodeContent.slice(0, 1500) : path;
            inputKind = 'text';
          } else if (toolName === 'replace_file_content') {
            const path = typeof cleanedArgs.TargetFile === 'string' ? cleanedArgs.TargetFile : '';
            const base = path.split('/').pop() || path;
            title = `Edit(${base})`;
            const target = typeof cleanedArgs.TargetContent === 'string' ? cleanedArgs.TargetContent : '';
            const repl = typeof cleanedArgs.ReplacementContent === 'string' ? cleanedArgs.ReplacementContent : '';
            input = `- ${target.slice(0, 500)}\n+ ${repl.slice(0, 500)}`;
            inputKind = 'diff';
          } else if (toolName === 'invoke_subagent') {
            title = 'Subagent';
            try {
              input = JSON.stringify(cleanedArgs.Subagents || cleanedArgs, null, 2);
              inputKind = 'json';
            } catch {
              input = String(cleanedArgs);
            }
          } else {
            const view = toolView(toolName, cleanedArgs);
            title = view.title;
            input = view.input;
            inputKind = view.inputKind;
          }

          this.count++;
          entries.push({
            id: `agy-term-tool-${this.count}`,
            kind: 'tool',
            tool: toolName,
            title,
            ...(input ? { input, inputKind } : {}),
            at: createdAt,
          });
        }
      }

      // 3. Resposta em texto do modelo
      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        this.count++;
        const prep = prepare(parsed.content.trim(), TEXT_MAX);
        entries.push({
          id: `agy-term-resp-${this.count}`,
          kind: 'assistant',
          text: prep.text,
          at: createdAt,
        });
      }
    } else if (type === 'GENERIC' || type === 'TOOL_RESULT') {
      const rawText = typeof parsed.content === 'string' ? parsed.content : '';
      if (rawText.trim()) {
        this.count++;
        const masked = maskSecrets(rawText);
        const lines = masked.split('\n');
        const truncated = masked.length > RESULT_MAX || lines.length > RESULT_MAX_LINES;
        const text = lines.slice(0, RESULT_MAX_LINES).join('\n').slice(0, RESULT_MAX);

        entries.push({
          id: `agy-term-res-${this.count}`,
          kind: 'result',
          toolUseId: `tool-${this.count}`,
          text,
          truncated: truncated || undefined,
          at: createdAt,
        });
      }
    }

    return entries;
  }
}

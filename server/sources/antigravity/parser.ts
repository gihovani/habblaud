// Parser de eventos de sessão do Antigravity (~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl)
import type { Activity, ActivityKind, AgentStatus } from '../../../shared/types';

export interface AntigravitySubagentInfo {
  name: string;
  role: string;
  prompt?: string;
}

export interface AntigravityParsedLine {
  activities?: Activity[];
  activity?: Activity;
  status?: AgentStatus;
  waitingFor?: string;
  cwd?: string;
  subagents?: AntigravitySubagentInfo[];
  statsDelta?: {
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
}

function cleanString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  let s = val.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}

export function describeAntigravityTool(toolName: string, args: Record<string, unknown> = {}): { kind: ActivityKind; icon: string; text: string; detail?: string; cwd?: string } {
  const toolSummary = cleanString(args.toolSummary);
  const toolAction = cleanString(args.toolAction);
  const command = cleanString(args.CommandLine);
  const cwd = cleanString(args.Cwd);
  const filePath = cleanString(args.TargetFile) || cleanString(args.AbsolutePath) || cleanString(args.Url);
  const fileName = filePath ? filePath.split('/').pop() : undefined;

  if (toolName === 'run_command') {
    if (command) {
      if (/\b(?:test|pytest|vitest|jest|phpunit)\b/i.test(command)) {
        return { kind: 'test', icon: '🧪', text: toolSummary || 'Rodando testes', detail: command, cwd };
      }
      if (/\bgit\b/i.test(command)) {
        return { kind: 'git', icon: '🌿', text: toolSummary || 'Comando git', detail: command, cwd };
      }
      if (/\b(?:build|compile|tsc)\b/i.test(command)) {
        return { kind: 'run', icon: '🏗️', text: toolSummary || 'Compilando projeto', detail: command, cwd };
      }
      return { kind: 'run', icon: '💻', text: toolSummary || 'Executando comando', detail: command, cwd };
    }
    return { kind: 'run', icon: '💻', text: toolSummary || 'Executando comando', cwd };
  }

  if (toolName === 'view_file') {
    return {
      kind: 'read',
      icon: '📖',
      text: toolSummary || (fileName ? `Lendo ${fileName}` : 'Lendo arquivo'),
      detail: filePath,
      cwd,
    };
  }

  if (toolName === 'write_to_file') {
    return {
      kind: 'edit',
      icon: '📝',
      text: toolSummary || (fileName ? `Criando ${fileName}` : 'Criando arquivo'),
      detail: filePath,
      cwd,
    };
  }

  if (toolName === 'replace_file_content') {
    return {
      kind: 'edit',
      icon: '✏️',
      text: toolSummary || (fileName ? `Editando ${fileName}` : 'Editando código'),
      detail: filePath,
      cwd,
    };
  }

  if (toolName === 'invoke_subagent' || toolName === 'define_subagent' || toolName === 'manage_subagents') {
    return {
      kind: 'delegate',
      icon: '🤝',
      text: toolSummary || 'Delegando para subagente',
      detail: toolAction || 'Coordenação de subagentes',
      cwd,
    };
  }

  if (toolName === 'ask_question') {
    return {
      kind: 'ask',
      icon: '❓',
      text: toolSummary || 'Aguardando resposta do usuário',
      detail: toolAction || 'Pergunta interativa',
      cwd,
    };
  }

  if (toolName === 'read_url_content' || toolName === 'search_web' || toolName.includes('search_docs') || toolName.includes('get_doc')) {
    return {
      kind: 'search',
      icon: '🔍',
      text: toolSummary || 'Pesquisando documentação/web',
      detail: filePath || cleanString(args.query),
      cwd,
    };
  }

  return {
    kind: 'skill',
    icon: '⚡',
    text: toolSummary || `Executando ${toolName}`,
    detail: toolAction || command || filePath,
    cwd,
  };
}

export function parseAntigravityJsonlLine(line: string, index: number, now: number = Date.now()): AntigravityParsedLine | undefined {
  if (!line || !line.trim()) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const type = parsed.type as string;
  const source = parsed.source as string;
  const status = parsed.status as string;
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  const thinking = typeof parsed.thinking === 'string' ? parsed.thinking : '';
  const toolCalls = Array.isArray(parsed.tool_calls) ? (parsed.tool_calls as Array<{ name?: string; args?: Record<string, unknown> }>) : [];

  const tokensIn = typeof parsed.input_tokens === 'number' ? parsed.input_tokens : 0;
  const tokensOut = typeof parsed.output_tokens === 'number' ? parsed.output_tokens : 0;

  // 1. Mensagem enviada pelo usuário (USER_INPUT)
  if (type === 'USER_INPUT') {
    // Extrai o prompt limpo do usuário removendo tags de sistema como <USER_REQUEST> e <ADDITIONAL_METADATA>
    let prompt = content;
    const reqMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(content);
    if (reqMatch && reqMatch[1]) {
      prompt = reqMatch[1].trim();
    } else {
      prompt = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return {
      activity: {
        id: `agy-prompt-${index}`,
        kind: 'prompt',
        icon: '💬',
        text: 'Nova instrução',
        detail: prompt.slice(0, 300) || 'Instrução do usuário',
        at: now,
      },
      status: 'working',
      statsDelta: {
        toolCalls: 0,
        tokensIn,
        tokensOut,
      },
    };
  }

  // 2. Resposta do modelo (PLANNER_RESPONSE)
  if (type === 'PLANNER_RESPONSE') {
    let detectedCwd: string | undefined;
    const subagents: AntigravitySubagentInfo[] = [];

    // Se há ferramentas chamadas nesta etapa
    if (toolCalls.length > 0) {
      const activities: Activity[] = [];
      let isWaiting = false;
      let waitingReason: string | undefined;

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const toolName = tc.name || 'tool';
        const args = tc.args || {};
        const desc = describeAntigravityTool(toolName, args);

        if (desc.cwd && !detectedCwd) {
          detectedCwd = desc.cwd;
        }

        if (toolName === 'ask_question') {
          isWaiting = true;
          waitingReason = 'responder perguntas';
        }

        if (toolName === 'invoke_subagent') {
          const subs = Array.isArray(args.Subagents) ? (args.Subagents as Array<{ TypeName?: string; Role?: string; Prompt?: string }>) : [];
          for (const s of subs) {
            if (s.TypeName || s.Role) {
              subagents.push({
                name: s.TypeName || 'subagent',
                role: s.Role || s.TypeName || 'Assistente',
                prompt: s.Prompt,
              });
            }
          }
        }

        activities.push({
          id: `agy-tool-${index}-${i}`,
          kind: desc.kind,
          icon: desc.icon,
          text: desc.text,
          detail: desc.detail,
          tool: toolName,
          at: now,
        });
      }

      return {
        activities,
        activity: activities[activities.length - 1],
        status: isWaiting ? 'waiting' : 'working',
        waitingFor: isWaiting ? waitingReason : undefined,
        cwd: detectedCwd,
        subagents: subagents.length > 0 ? subagents : undefined,
        statsDelta: {
          toolCalls: toolCalls.length,
          tokensIn,
          tokensOut,
        },
      };
    }

    // Se tem pensamento (thinking) e não tem tool calls
    if (thinking && thinking.trim()) {
      return {
        activity: {
          id: `agy-think-${index}`,
          kind: 'think',
          icon: '🧠',
          text: 'Pensando...',
          detail: thinking.trim().slice(0, 150),
          at: now,
        },
        status: 'working',
        statsDelta: {
          toolCalls: 0,
          tokensIn,
          tokensOut,
        },
      };
    }

    // Se concluiu a resposta (texto puro ou status DONE)
    if (content && content.trim() && status === 'DONE') {
      const cleanText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        activity: {
          id: `agy-resp-${index}`,
          kind: 'respond',
          icon: '💬',
          text: 'Respondendo',
          detail: cleanText.slice(0, 150),
          at: now,
        },
        status: 'idle',
        statsDelta: {
          toolCalls: 0,
          tokensIn,
          tokensOut,
        },
      };
    }
  }

  return undefined;
}

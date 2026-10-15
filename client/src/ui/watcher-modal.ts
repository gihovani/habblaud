// Janela flutuante de visualização de logs em tempo real do Pipeline Watcher.
import { copyText, h, iconButton, setHidden, setText, setTitle } from './dom';
import { ICONS } from './icons';
import { Movable } from './movable';
import { tr } from '../../../shared/i18n';

/** Converte códigos ANSI básicos em HTML estilizado ou remove sequências complexas. */
function renderAnsi(text: string): string {
  const sanitized = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Mapeamento básico de cores ANSI comuns
  return sanitized
    .replace(/\x1b\[0?m/g, '</span>')
    .replace(/\x1b\[1m/g, '<span class="ansi-bold">')
    .replace(/\x1b\[31m/g, '<span class="ansi-red">')
    .replace(/\x1b\[32m/g, '<span class="ansi-green">')
    .replace(/\x1b\[33m/g, '<span class="ansi-yellow">')
    .replace(/\x1b\[34m/g, '<span class="ansi-blue">')
    .replace(/\x1b\[35m/g, '<span class="ansi-purple">')
    .replace(/\x1b\[36m/g, '<span class="ansi-cyan">')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // Remove outras sequências ANSI
}

export class WatcherLogsModal {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private badgeEl: HTMLElement;
  private outputEl: HTMLElement;
  private autoScrollBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private movable: Movable;

  private currentRoomId: string | null = null;
  private es: EventSource | null = null;
  private autoScroll = true;

  constructor() {
    this.titleEl = h('span', { class: 'ui-watcher-modal__title', text: 'Pipeline Watcher' });
    this.badgeEl = h('span', { class: 'ui-watcher-badge', text: '⚪ Parado' });

    this.autoScrollBtn = h('button', {
      class: 'ui-btn ui-btn--xs ui-watcher-btn is-active',
      type: 'button',
      title: tr('Rolar automaticamente com novas mensagens'),
      on: { click: () => this.toggleAutoScroll() },
    }, h('span', { text: '⬇️ Auto-scroll' }));

    this.copyBtn = iconButton(ICONS.copy, tr('Copiar logs'), () => this.copyLogs());
    this.clearBtn = iconButton(ICONS.pencil, tr('Limpar tela'), () => this.clearLogs());
    this.closeBtn = iconButton(ICONS.close, tr('Fechar'), (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    const header = h(
      'div',
      { class: 'ui-watcher-modal__header' },
      h('div', { class: 'ui-watcher-modal__head-left' }, this.titleEl, this.badgeEl),
      h('div', { class: 'ui-watcher-modal__head-actions' }, this.autoScrollBtn, this.copyBtn, this.clearBtn, this.closeBtn),
    );

    this.outputEl = h('pre', { class: 'ui-watcher-modal__output' });

    this.el = h(
      'div',
      { class: 'ui-watcher-modal', hidden: true },
      header,
      this.outputEl,
    );
    this.el.style.display = 'none';

    this.movable = new Movable(this.el, header, {
      key: 'habblaud:watcher-modal',
      enabled: () => window.innerWidth > 640,
    });

    const rootEl = document.querySelector('.ui-root') ?? document.getElementById('ui-app') ?? document.body;
    rootEl.append(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden && this.el.style.display !== 'none') {
        this.close();
      }
    });
  }

  private toggleAutoScroll(): void {
    this.autoScroll = !this.autoScroll;
    this.autoScrollBtn.classList.toggle('is-active', this.autoScroll);
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private copyLogs(): void {
    const text = this.outputEl.innerText;
    copyText(text);
    setTitle(this.copyBtn, tr('Copiado!'));
    setTimeout(() => {
      setTitle(this.copyBtn, tr('Copiar logs'));
    }, 1500);
  }

  private clearLogs(): void {
    this.outputEl.innerHTML = '';
    if (this.currentRoomId) {
      fetch('/api/rooms/watcher/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.currentRoomId }),
      }).catch(() => {});
    }
  }

  open(roomId: string, roomName: string, roomPath: string): void {
    this.currentRoomId = roomId;
    setText(this.titleEl, `Watcher — ${roomName}`);
    setHidden(this.el, false);
    this.el.style.display = 'flex';

    // Desconecta SSE anterior
    this.disconnect();

    // Inicia SSE stream
    const url = `/api/rooms/watcher/stream?id=${encodeURIComponent(roomId)}&path=${encodeURIComponent(roomPath)}`;
    const es = new EventSource(url);
    this.es = es;

    es.addEventListener('init', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { logs?: string; status?: { running?: boolean; pid?: number } };
        this.outputEl.innerHTML = renderAnsi(data.logs ?? '');
        this.updateBadge(!!data.status?.running, data.status?.pid);
        if (this.autoScroll) this.scrollToBottom();
      } catch {
        // Ignora
      }
    });

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { chunk?: string };
        if (data.chunk) {
          this.outputEl.innerHTML += renderAnsi(data.chunk);
          if (this.autoScroll) this.scrollToBottom();
        }
      } catch {
        // Ignora
      }
    };

    es.addEventListener('exit', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { code?: number };
        this.updateBadge(false);
        this.outputEl.innerHTML += `\n<span class="ansi-yellow">[Processo finalizado com código ${data.code ?? 0}]</span>\n`;
        if (this.autoScroll) this.scrollToBottom();
      } catch {
        // Ignora
      }
    });

    es.onerror = () => {
      // Reconexão automática é tratada pelo EventSource
    };
  }

  updateBadge(running: boolean, pid?: number): void {
    if (running) {
      this.badgeEl.className = 'ui-watcher-badge is-running';
      setText(this.badgeEl, `🟢 Rodando${pid ? ` (PID ${pid})` : ''}`);
    } else {
      this.badgeEl.className = 'ui-watcher-badge';
      setText(this.badgeEl, '⚪ Parado');
    }
  }

  close(): void {
    setHidden(this.el, true);
    this.el.style.display = 'none';
    this.disconnect();
  }

  private disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }
}

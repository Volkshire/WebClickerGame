export type AlertSeverity = 'info' | 'warning' | 'error';

interface ActiveAlert {
  message: string;
  severity: AlertSeverity;
  timer: number | null;
}

/**
 * Single-slot-per-id stack of dismissible warnings shown at the top of the
 * page. Used for save-threatening conditions (blocked storage, a second live
 * game tab, restore failures) that must be visible — console errors alone
 * were how progress loss stayed invisible.
 */
export class AlertBanner {
  private readonly root: HTMLElement;
  private readonly active = new Map<string, ActiveAlert>();

  constructor(mount: ParentNode) {
    this.root = document.createElement('div');
    this.root.className = 'alert-banner-stack';
    this.root.setAttribute('role', 'alert');
    mount.appendChild(this.root);
  }

  /**
   * Shows (or updates) the banner for `id`. Warnings auto-hide after
   * `autoHideMs`; errors stay until dismissed. Passing `null` removes it.
   */
  show(id: string, message: string | null, severity: AlertSeverity = 'error', autoHideMs = 0): void {
    if (message === null) {
      this.dismiss(id);
      return;
    }

    const existing = this.active.get(id);
    if (existing !== undefined) {
      existing.message = message;
      existing.severity = severity;
      const textEl = this.root.querySelector<HTMLElement>(`[data-alert-id="${id}"] .alert-banner-text`);
      if (textEl !== null) textEl.textContent = message;
      return;
    }

    const row = document.createElement('div');
    row.className = `alert-banner is-${severity}`;
    row.dataset['alertId'] = id;

    const text = document.createElement('span');
    text.className = 'alert-banner-text';
    text.textContent = message;
    row.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'alert-banner-dismiss';
    dismiss.textContent = '✕';
    dismiss.setAttribute('aria-label', 'Dismiss warning');
    dismiss.addEventListener('click', () => this.dismiss(id));
    row.appendChild(dismiss);

    this.root.appendChild(row);
    this.active.set(id, { message, severity, timer: null });

    if (severity !== 'error' && autoHideMs > 0) {
      const timer = window.setTimeout(() => this.dismiss(id), autoHideMs);
      const alert = this.active.get(id);
      if (alert !== undefined) alert.timer = timer;
    }
  }

  dismiss(id: string): void {
    const alert = this.active.get(id);
    if (alert === undefined) return;
    if (alert.timer !== null) clearTimeout(alert.timer);
    this.active.delete(id);
    this.root.querySelector(`[data-alert-id="${id}"]`)?.remove();
  }
}

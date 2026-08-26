/**
 * Minimal tab controller: buttons with [data-tab="id"] toggle panes with
 * [data-tab-pane="id"]. The controller owns pane visibility exclusively —
 * systems must never write `hidden` on a pane themselves (see the Legion
 * handoff in main.ts).
 */
export class TabController {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly panes = new Map<string, HTMLElement>();
  private activeId: string | null = null;

  constructor(root: ParentNode) {
    root.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((button) => {
      const id = button.dataset['tab'] ?? '';
      if (id === '') return;
      this.buttons.set(id, button);
      button.addEventListener('click', () => this.select(id));
    });

    root.querySelectorAll<HTMLElement>('[data-tab-pane]').forEach((pane) => {
      const id = pane.dataset['tabPane'] ?? '';
      if (id === '') return;
      this.panes.set(id, pane);
    });

    const first = this.buttons.keys().next();
    if (first.done !== true) this.select(first.value);
  }

  select(id: string): void {
    const pane = this.panes.get(id);
    const button = this.buttons.get(id);
    if (pane === undefined || button === undefined || button.disabled || button.hidden) return;

    for (const [otherId, otherPane] of this.panes) {
      otherPane.hidden = otherId !== id;
    }
    for (const [otherId, otherButton] of this.buttons) {
      otherButton.setAttribute('aria-selected', otherId === id ? 'true' : 'false');
    }
    button.classList.remove('has-notification');
    this.activeId = id;
  }

  /** Returns true when the given tab is currently active. */
  isActive(id: string): boolean {
    return this.activeId === id;
  }

  /** Adds the notification glow to a tab button (removed automatically on select). */
  notify(id: string): void {
    const button = this.buttons.get(id);
    if (button !== undefined && !button.hidden) {
      button.classList.add('has-notification');
    }
  }

  /** Removes the notification glow without switching tabs. */
  clearNotification(id: string): void {
    const button = this.buttons.get(id);
    if (button !== undefined) button.classList.remove('has-notification');
  }

  /** Locks or unlocks a tab; falling back to the first open tab if needed. */
  setLocked(id: string, locked: boolean): void {
    const button = this.buttons.get(id);
    if (button === undefined) return;
    button.disabled = locked;
    if (locked && this.activeId === id) {
      const first = [...this.buttons.values()].find((entry) => !entry.disabled);
      if (first !== undefined) this.select(first.dataset['tab'] ?? '');
    }
  }

  /**
   * Shows/hides a whole system tab (locked systems are not rendered at all).
   * Hidden tabs leave the layout entirely; if the active tab was hidden,
   * focus falls back to the first visible, enabled tab.
   */
  setHidden(id: string, hidden: boolean): void {
    const button = this.buttons.get(id);
    if (button === undefined) return;
    button.hidden = hidden;

    if (hidden && this.activeId === id) {
      const fallback = [...this.buttons.values()].find(
        (entry) => !entry.hidden && !entry.disabled,
      );
      if (fallback !== undefined) this.select(fallback.dataset['tab'] ?? '');
    }
  }
}

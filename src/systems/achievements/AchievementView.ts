import { formatNumber } from '../../ui/format';
import type { AchievementViewData, AchievementsChangedPayload } from './types';

interface AchievementRowRefs {
  row: HTMLElement;
  statusChip: HTMLElement;
  progressLabel: HTMLElement;
  /** Text nodes that vary with mask state; refreshed on every render. */
  nameEl: HTMLElement;
  descriptionEl: HTMLElement;
  rewardEl: HTMLElement;
}

/**
 * Trophy-button overlay panel listing every achievement. Rows mirror the
 * definitions data (add/remove without touching this view); the panel is
 * a fixed overlay anchored below the persistent header, so it never
 * consumes layout space on the main screen.
 */
export class AchievementView {
  private readonly toggleButton: HTMLButtonElement;
  private readonly panelEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly headerEl: HTMLElement | null;
  private readonly rows = new Map<string, AchievementRowRefs>();

  constructor(root: ParentNode) {
    const toggle = root.querySelector<HTMLButtonElement>('[data-achievements="toggle"]');
    const panel = root.querySelector<HTMLElement>('[data-achievements="panel"]');
    const summary = root.querySelector<HTMLElement>('[data-achievements="summary"]');
    const list = root.querySelector<HTMLElement>('[data-achievements="list"]');
    const close = root.querySelector<HTMLButtonElement>('[data-achievements="close"]');

    const required: [unknown, string][] = [
      [toggle, 'toggle'],
      [panel, 'panel'],
      [summary, 'summary'],
      [list, 'list'],
      [close, 'close'],
    ];
    for (const [element, name] of required) {
      if (element === null) {
        throw new Error(`achievement element [data-achievements="${name}"] not found`);
      }
    }

    this.toggleButton = toggle!;
    this.panelEl = panel!;
    this.summaryEl = summary!;
    this.listEl = list!;
    this.closeButton = close!;
    // Optional anchor: the panel sits directly below the game header.
    this.headerEl = root.querySelector<HTMLElement>('.game-header');

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.closeButton.addEventListener('click', () => this.close());
    document.addEventListener('keydown', this.onDocumentKeydown);
    window.addEventListener('resize', this.repositionWhileOpen);
  }

  get isOpen(): boolean {
    return this.panelEl.hidden === false;
  }

  render(payload: AchievementsChangedPayload): void {
    const total = payload.achievements.length;
    this.summaryEl.textContent = `${payload.completedCount} / ${total} completed`;
    this.syncRows(payload.achievements);
  }

  open(): void {
    if (this.isOpen) return;
    this.positionBelowHeader();
    this.panelEl.hidden = false;
    this.toggleButton.setAttribute('aria-expanded', 'true');
    this.closeButton.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.panelEl.hidden = true;
    this.toggleButton.setAttribute('aria-expanded', 'false');
    if (document.activeElement !== null && this.panelEl.contains(document.activeElement)) {
      this.toggleButton.focus();
    }
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Anchors the overlay's top edge to the bottom of the game header. */
  private positionBelowHeader(): void {
    const rect = this.headerEl?.getBoundingClientRect();
    const top = rect ? Math.max(0, rect.bottom) : 0;
    this.panelEl.style.top = `${top}px`;
  }

  private repositionWhileOpen = (): void => {
    if (this.isOpen) this.positionBelowHeader();
  };

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return;
    // A modal dialog layered above the panel owns the Escape key; closing
    // the panel underneath it at the same time would be disorienting.
    if (document.querySelector('.modal-overlay:not([hidden])') !== null) return;
    this.close();
  };

  private syncRows(definitions: AchievementViewData[]): void {
    for (const [id, refs] of this.rows) {
      if (definitions.some((entry) => entry.id === id)) continue;
      refs.row.remove();
      this.rows.delete(id);
    }

    for (const definition of definitions) {
      let refs = this.rows.get(definition.id);
      if (refs === undefined) {
        refs = this.createRow(definition);
        this.rows.set(definition.id, refs);
      }
      this.updateRow(refs, definition);
    }
  }

  private createRow(definition: AchievementViewData): AchievementRowRefs {
    const row = document.createElement('div');
    row.className = 'item-row achievement-row';

    const main = document.createElement('div');
    main.className = 'item-main';

    const nameLine = document.createElement('div');
    nameLine.className = 'item-name';

    const name = document.createElement('span');
    name.textContent = definition.name;

    const statusChip = document.createElement('span');
    statusChip.className = 'item-chip achievement-status';

    nameLine.append(name, statusChip);

    const description = document.createElement('p');
    description.className = 'item-effect achievement-desc';
    description.textContent = definition.description;

    main.append(nameLine, description);

    const side = document.createElement('div');
    side.className = 'achievement-side';

    const progressLabel = document.createElement('p');
    progressLabel.className = 'achievement-progress';

    const reward = document.createElement('p');
    reward.className = 'achievement-reward';
    reward.textContent = definition.rewardText;

    side.append(progressLabel, reward);
    row.append(main, side);
    this.listEl.appendChild(row);

    return { row, statusChip, progressLabel, nameEl: name, descriptionEl: description, rewardEl: reward };
  }

  private updateRow(refs: AchievementRowRefs, definition: AchievementViewData): void {
    refs.row.classList.toggle('is-completed', definition.completed);
    refs.row.classList.toggle('is-masked', definition.masked);

    // Always mirror the payload's current text so a row that started hidden
    // (??? / "Hidden achievement") refreshes to its real name/description/
    // reward the moment it completes (and back to redacted if re-masked).
    refs.nameEl.textContent = definition.name;
    refs.descriptionEl.textContent = definition.description;
    refs.rewardEl.textContent = definition.rewardText;

    if (definition.masked) {
      // System-side redaction already blanked the text; just style it.
      refs.statusChip.textContent = 'Hidden';
      refs.progressLabel.textContent = '';
      return;
    }

    refs.statusChip.textContent = definition.completed ? '✓ Done' : 'Open';
    refs.progressLabel.textContent =
      definition.progress === null
        ? ''
        : `${formatNumber(definition.progress.current)} / ${formatNumber(definition.progress.goal)}`;
  }
}

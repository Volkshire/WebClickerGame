import { formatNumber } from '../../ui/format';
import type { PrestigeChangedPayload, PrestigePerformFailureReason } from './types';

const FAILURE_MESSAGES: Record<PrestigePerformFailureReason, string> = {
  'not-available': 'Prestige is not available right now.',
  'battle-active': 'A battle is still resolving — wait for it to finish.',
  storage:
    'Saving your Prestige failed. The run was NOT reset — check storage permissions or free space.',
};

/**
 * End-of-run exposure for Prestige: a compact badge in the World panel plus
 * a confirmation modal. Both stay hidden until the first Prestige or a
 * completed campaign so early/mid-game UI stays uncluttered.
 */
export class PrestigeView {
  private readonly badgeEl: HTMLButtonElement;
  private readonly badgeCountEl: HTMLElement;
  private readonly badgeBonusEl: HTMLElement;
  private readonly badgeHintEl: HTMLElement | null;
  private readonly modalEl: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly bonusLabel: HTMLElement;
  private readonly pendingLabel: HTMLElement;
  private readonly availabilityLabel: HTMLElement;
  private readonly failureLabel: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement | null;

  private confirmHandler: (() => void) | null = null;
  private lastFocused: HTMLElement | null = null;

  constructor(root: ParentNode) {
    const badge = root.querySelector<HTMLButtonElement>('[data-prestige="badge"]');
    const badgeCount = root.querySelector<HTMLElement>('[data-prestige="badge-count"]');
    const badgeBonus = root.querySelector<HTMLElement>('[data-prestige="badge-bonus"]');
    const modal = root.querySelector<HTMLElement>('[data-prestige="modal"]');
    const count = root.querySelector<HTMLElement>('[data-prestige="count"]');
    const bonus = root.querySelector<HTMLElement>('[data-prestige="bonus"]');
    const pending = root.querySelector<HTMLElement>('[data-prestige="pending"]');
    const availability = root.querySelector<HTMLElement>('[data-prestige="availability"]');
    const failure = root.querySelector<HTMLElement>('[data-prestige="failure"]');
    const confirm = root.querySelector<HTMLButtonElement>('[data-prestige="confirm"]');
    const cancel = root.querySelector<HTMLButtonElement>('[data-prestige="cancel"]');
    const close = root.querySelector<HTMLButtonElement>('[data-prestige="close"]');
    const badgeHint = root.querySelector<HTMLElement>('[data-prestige="badge-hint"]');

    const required: [unknown, string][] = [
      [badge, 'badge'],
      [badgeCount, 'badge-count'],
      [badgeBonus, 'badge-bonus'],
      [modal, 'modal'],
      [count, 'count'],
      [bonus, 'bonus'],
      [pending, 'pending'],
      [availability, 'availability'],
      [failure, 'failure'],
      [confirm, 'confirm'],
      [cancel, 'cancel'],
    ];
    for (const [element, name] of required) {
      if (element === null) throw new Error(`prestige element [data-prestige="${name}"] not found`);
    }

    this.badgeEl = badge!;
    this.badgeCountEl = badgeCount!;
    this.badgeBonusEl = badgeBonus!;
    this.modalEl = modal!;
    this.countLabel = count!;
    this.bonusLabel = bonus!;
    this.pendingLabel = pending!;
    this.availabilityLabel = availability!;
    this.failureLabel = failure!;
    this.confirmButton = confirm!;
    this.cancelButton = cancel!;
    this.closeButton = close;
    this.badgeHintEl = badgeHint;

    this.badgeEl.addEventListener('click', () => this.open());
    this.cancelButton.addEventListener('click', () => this.close());
    this.closeButton?.addEventListener('click', () => this.close());
    this.modalEl.addEventListener('click', (event) => {
      if (event.target === this.modalEl) this.close();
    });
    // Close first so a failing handler can reopen with its reason visible.
    this.confirmButton.addEventListener('click', () => {
      this.close();
      this.confirmHandler?.();
    });
  }

  onConfirm(handler: () => void): void {
    this.confirmHandler = handler;
  }

  /** Surfaces why a confirmed Prestige did not happen; reopens the modal. */
  showFailure(reason: PrestigePerformFailureReason): void {
    this.failureLabel.hidden = false;
    this.failureLabel.textContent = FAILURE_MESSAGES[reason];
    this.open();
  }

  render(payload: PrestigeChangedPayload): void {
    const actionReady = payload.campaignCompleted && !payload.battleActive;

    this.badgeEl.hidden = !(payload.campaignCompleted || payload.count > 0);
    // Pre-unlock: explain what opens the Gate instead of a bare panel.
    if (this.badgeHintEl !== null) this.badgeHintEl.hidden = !this.badgeEl.hidden;
    this.badgeCountEl.textContent = formatNumber(payload.count);
    this.badgeBonusEl.textContent = `+${payload.damageBonusPercent}%`;
    this.badgeEl.classList.toggle('is-available', actionReady);

    this.countLabel.textContent = formatNumber(payload.count);
    this.bonusLabel.textContent = `+${payload.damageBonusPercent}%`;

    // Rewards earned this run (Age conquests, achievements) awaiting claim.
    this.pendingLabel.hidden = payload.pendingPoints <= 0;
    this.pendingLabel.textContent =
      `Unclaimed rewards: +${formatNumber(payload.pendingPoints)} — ` +
      'perform a Prestige to bank them.';

    this.confirmButton.disabled = !actionReady;
    this.availabilityLabel.textContent = payload.battleActive
      ? 'A battle is resolving — wait for it to finish.'
      : payload.campaignCompleted
        ? ''
        : 'Reach the end of the world to unlock Prestige.';

    if (!actionReady && this.modalEl.hidden === false) {
      // A reset elsewhere can revoke availability while the modal is open.
      this.close();
    }
  }

  open(): void {
    if (this.modalEl.hidden === false) return;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modalEl.hidden = false;
    document.addEventListener('keydown', this.onModalKeydown);
    (this.confirmButton.disabled ? this.cancelButton : this.confirmButton).focus();
  }

  close(): void {
    if (this.modalEl.hidden === true) return;
    this.modalEl.hidden = true;
    this.failureLabel.hidden = true;
    document.removeEventListener('keydown', this.onModalKeydown);
    this.lastFocused?.focus();
    this.lastFocused = null;
  }

  /** Escape closes the dialog; Tab cycles within it (two-button dialog). */
  private readonly onModalKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = [this.closeButton, this.confirmButton, this.cancelButton].filter(
      (button): button is HTMLButtonElement => button !== null && !button.disabled,
    );
    if (focusables.length === 0) return;

    const index = focusables.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? index <= 0
        ? focusables.length - 1
        : index - 1
      : index === -1 || index === focusables.length - 1
        ? 0
        : index + 1;
    event.preventDefault();
    focusables[next].focus();
  };
}

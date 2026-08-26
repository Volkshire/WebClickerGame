import { formatNumber } from '../../ui/format';
import { SHOP_ITEMS, checkShopRequirement } from './shop';
import type { ShopItemDefinition } from './shop';
import type { PrestigeChangedPayload } from './types';

interface ShopRowRefs {
  row: HTMLElement;
  ownedLabel: HTMLElement;
  lockedLabel: HTMLElement;
  buyButton: HTMLButtonElement;
}

/**
 * Prestige Shop dialog: a live Prestige Point counter plus a grid of
 * catalog items. Rows are built/removed straight from the SHOP_ITEMS
 * data, so the catalog can be edited freely without touching this view.
 * The view never mutates state — purchases go through the wiring layer.
 */
export class PrestigeShopView {
  private readonly modalEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly rows = new Map<string, ShopRowRefs>();

  private buyHandler: ((itemId: string) => void) | null = null;
  private lastFocused: HTMLElement | null = null;

  constructor(root: ParentNode) {
    const modal = root.querySelector<HTMLElement>('[data-shop="modal"]');
    const card = modal?.querySelector<HTMLElement>('.modal-card') ?? null;
    const points = root.querySelector<HTMLElement>('[data-shop="points"]');
    const list = root.querySelector<HTMLElement>('[data-shop="list"]');
    const close = root.querySelector<HTMLButtonElement>('[data-shop="close"]');

    const required: [unknown, string][] = [
      [modal, 'modal'],
      [points, 'points'],
      [list, 'list'],
      [close, 'close'],
    ];
    for (const [element, name] of required) {
      if (element === null) throw new Error(`prestige shop element [data-shop="${name}"] not found`);
    }

    this.modalEl = modal!;
    this.cardEl = card ?? this.modalEl;
    this.pointsEl = points!;
    this.listEl = list!;
    this.closeButton = close!;

    this.closeButton.addEventListener('click', () => this.close());
    this.modalEl.addEventListener('click', (event) => {
      if (event.target === this.modalEl) this.close();
    });
  }

  onBuy(handler: (itemId: string) => void): void {
    this.buyHandler = handler;
  }

  render(payload: PrestigeChangedPayload): void {
    this.pointsEl.textContent = formatNumber(payload.points);
    this.syncRows(payload);
  }

  open(): void {
    if (this.modalEl.hidden === false) return;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modalEl.hidden = false;
    document.addEventListener('keydown', this.onKeydown);
    this.closeButton.focus();
  }

  close(): void {
    if (this.modalEl.hidden === true) return;
    this.modalEl.hidden = true;
    document.removeEventListener('keydown', this.onKeydown);
    this.lastFocused?.focus();
    this.lastFocused = null;
  }

  /** Escape closes; Tab cycles within the dialog. */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = [...this.cardEl.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
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

  /** Mirrors the catalog into rows: adds new definitions, drops removed ones. */
  private syncRows(payload: PrestigeChangedPayload): void {
    for (const [id, refs] of this.rows) {
      if (SHOP_ITEMS.some((item) => item.id === id)) continue;
      refs.row.remove();
      this.rows.delete(id);
    }

    for (const item of SHOP_ITEMS) {
      let refs = this.rows.get(item.id);
      if (refs === undefined) {
        refs = this.createRow(item);
        this.rows.set(item.id, refs);
      }
      this.updateRow(item, refs, payload);
    }
  }

  private createRow(item: ShopItemDefinition): ShopRowRefs {
    const row = document.createElement('div');
    row.className = 'item-row shop-row';

    const main = document.createElement('div');
    main.className = 'item-main';

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;

    const description = document.createElement('p');
    description.className = 'item-effect shop-effect';
    description.textContent = item.description;

    const ownedLabel = document.createElement('div');
    ownedLabel.className = 'shop-owned';
    ownedLabel.hidden = true;

    // Visible lock reason: tooltips are unreachable on touch devices.
    const lockedLabel = document.createElement('div');
    lockedLabel.className = 'shop-locked';
    lockedLabel.textContent = '🔒 Locked — meet the requirement to unlock this boon.';
    lockedLabel.hidden = true;

    main.append(name, description, ownedLabel, lockedLabel);

    const side = document.createElement('div');
    side.className = 'shop-side';

    const cost = document.createElement('span');
    cost.className = 'item-chip';
    cost.textContent = `${formatNumber(item.cost)} PP`;

    const buyButton = document.createElement('button');
    buyButton.type = 'button';
    buyButton.className = 'buy-button';
    buyButton.textContent = 'Buy';
    buyButton.addEventListener('click', () => this.buyHandler?.(item.id));

    side.append(cost, buyButton);
    row.append(main, side);
    this.listEl.appendChild(row);

    return { row, ownedLabel, lockedLabel, buyButton };
  }

  private updateRow(
    item: ShopItemDefinition,
    refs: ShopRowRefs,
    payload: PrestigeChangedPayload,
  ): void {
    const owned = payload.purchases[item.id] ?? 0;
    const maxed = item.maxPurchases !== null && owned >= item.maxPurchases;
    const locked =
      !maxed &&
      item.requires !== undefined &&
      !checkShopRequirement(item.requires, {
        prestigeCount: payload.count,
        ownedOf: (id) => payload.purchases[id] ?? 0,
      });
    const affordable = payload.points >= item.cost;

    const purchasable = affordable && !maxed && !locked;
    refs.buyButton.disabled = !purchasable;
    refs.buyButton.textContent = maxed ? 'Owned' : locked ? 'Locked' : 'Buy';
    refs.buyButton.title = locked ? 'Locked — meet the requirement first.' : '';

    // Visible lock line: the tooltip is unreachable on touch devices.
    refs.lockedLabel.hidden = !locked;

    refs.ownedLabel.hidden = owned <= 0;
    refs.ownedLabel.textContent = owned > 0 ? `Owned ×${owned}` : '';

    refs.row.classList.toggle('is-affordable', purchasable);
    refs.row.classList.toggle('is-owned', maxed);
    refs.row.classList.toggle('is-locked', locked && !maxed);
  }
}

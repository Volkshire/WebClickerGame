import { formatNumber } from '../../ui/format';
import type { ResourceId } from '../resources/types';
import type {
  BuildingCostEntry,
  BuildingStocks,
  BuildingViewRow,
  BuildingsChangedPayload,
} from './types';

const CURRENCY_ICONS: Record<string, string> = {
  souls: '⚡',
  bone: '🦴',
  flesh: '🍖',
  iron: '⚙️',
};

const CURRENCY_TITLES: Record<string, string> = {
  souls: 'Souls',
  bone: 'Bone',
  flesh: 'Flesh',
  iron: 'Iron',
};

interface Row {
  root: HTMLDivElement;
  chip: HTMLElement;
  description: HTMLElement;
  effect: HTMLElement;
  flavor: HTMLElement;
  cost: HTMLElement;
  buyButton: HTMLButtonElement;
}

/** Renders the Crypt pane: one card row per building definition. */
export class BuildingView {
  private readonly listEl: HTMLElement;
  private readonly stocksLabel: HTMLElement | null;
  private readonly rows = new Map<string, Row>();
  private buyHandler: ((buildingId: string) => void) | null = null;

  constructor(root: ParentNode) {
    const list = root.querySelector<HTMLElement>('[data-buildings="list"]');
    if (list === null) throw new Error('buildings element [data-buildings="list"] not found');
    this.listEl = list;
    this.stocksLabel = root.querySelector<HTMLElement>('[data-buildings="stocks"]');
  }

  onBuy(handler: (buildingId: string) => void): void {
    this.buyHandler = handler;
  }

  /** Red shake when a build/upgrade is rejected (affordability went stale). */
  notifyDenied(buildingId: string): void {
    const row = this.rows.get(buildingId);
    if (row === undefined) return;
    row.root.classList.remove('is-denied');
    void row.root.offsetWidth;
    row.root.classList.add('is-denied');
  }

  render(payload: BuildingsChangedPayload, stocks: BuildingStocks): void {
    if (this.stocksLabel !== null) {
      this.stocksLabel.textContent =
        `⚡ ${formatNumber(stocks.souls)} · 🦴 ${formatNumber(stocks.bone)}` +
        ` · 🍖 ${formatNumber(stocks.flesh)} · ⚙️ ${formatNumber(stocks.iron)}`;
    }

    for (const item of payload.buildings) {
      const row = this.ensureRow(item);
      const maxed = item.level >= item.maxLevel;

      row.chip.textContent = item.level > 0 ? `Lv ${item.level}` : '';
      row.chip.hidden = item.level === 0; // no empty grey pill on unbuilt rows
      row.description.textContent = item.description;
      row.effect.textContent = item.effectText;
      row.effect.hidden = item.effectText === '';
      row.flavor.textContent = item.flavor;
      // Maxed rows get their own "done" tint instead of looking unaffordable.
      row.root.classList.toggle('is-owned', maxed);

      this.renderCosts(row.cost, item, stocks);

      if (maxed) {
        row.buyButton.textContent = item.maxLevel === 1 ? 'BUILT' : 'MAX';
        row.buyButton.disabled = true;
      } else {
        // Cost chips below the card name carry the price; the button stays
        // short so narrow Crypt columns never overflow.
        row.buyButton.textContent = item.level === 0 ? 'BUILD' : 'UPGRADE';
        row.buyButton.disabled = !this.isAffordable(item.nextCosts, stocks);
      }
    }
  }

  private isAffordable(costs: readonly BuildingCostEntry[], stocks: BuildingStocks): boolean {
    return costs.every((entry) => this.stockOf(stocks, entry.currency) >= entry.amount);
  }

  private stockOf(stocks: BuildingStocks, currency: string): number {
    if (currency === 'souls') return stocks.souls;
    return stocks[currency as ResourceId] ?? 0;
  }

  private renderCosts(
    container: HTMLElement,
    item: BuildingViewRow,
    stocks: BuildingStocks,
  ): void {
    container.replaceChildren();
    if (item.nextCosts.length === 0) return;

    for (const entry of item.nextCosts) {
      const part = document.createElement('span');
      const affordable = this.stockOf(stocks, entry.currency) >= entry.amount;
      part.className = `cost-part ${affordable ? 'is-ok' : 'is-short'}`;
      part.title = CURRENCY_TITLES[entry.currency] ?? entry.currency;
      part.textContent = `${CURRENCY_ICONS[entry.currency] ?? ''}${formatNumber(entry.amount)}`;
      container.append(part);
    }
  }

  private ensureRow(item: BuildingViewRow): Row {
    let row = this.rows.get(item.id);
    if (row !== undefined) return row;

    const container = document.createElement('div');
    container.className = 'item-row building-row';

    const main = document.createElement('div');
    main.className = 'item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;

    const chip = document.createElement('em');
    chip.className = 'item-chip';
    nameEl.appendChild(chip);

    // Static what-it-does line: visible even before the first purchase.
    const description = document.createElement('span');
    description.className = 'item-effect building-desc';

    const effect = document.createElement('span');
    effect.className = 'item-effect';
    effect.hidden = true;

    const flavor = document.createElement('span');
    flavor.className = 'item-flavor';

    const cost = document.createElement('span');
    cost.className = 'building-cost';

    main.append(nameEl, description, effect, flavor, cost);

    const buyButton = document.createElement('button');
    buyButton.type = 'button';
    buyButton.className = 'buy-button';
    buyButton.textContent = 'BUILD';
    buyButton.addEventListener('click', () => this.buyHandler?.(item.id));

    container.append(main, buyButton);
    this.listEl.appendChild(container);

    row = { root: container, chip, description, effect, flavor, cost, buyButton };
    this.rows.set(item.id, row);
    return row;
  }
}

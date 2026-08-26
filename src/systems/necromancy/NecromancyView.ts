import { formatNumber } from '../../ui/format';
import type { ResourceId } from '../resources/types';
import type {
  BuildingCostEntry,
  BuildingStocks,
  NecromancyChangedPayload,
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

/**
 * Renders the Necromancy research panel: locked subline until the wiring
 * layer says otherwise, then one card row per upgrade definition.
 */
export class NecromancyView {
  private readonly panelEl: HTMLElement | null;
  private readonly lockedEl: HTMLElement | null;
  private readonly contentEl: HTMLElement | null;
  private readonly listEl: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private buyHandler: ((upgradeId: string) => void) | null = null;

  constructor(root: ParentNode) {
    const list = root.querySelector<HTMLElement>('[data-necromancy="list"]');
    if (list === null) throw new Error('necromancy element [data-necromancy="list"] not found');
    this.listEl = list;
    this.panelEl = root.querySelector<HTMLElement>('[data-necromancy="panel"]');
    this.lockedEl = root.querySelector<HTMLElement>('[data-necromancy="locked"]');
    this.contentEl = root.querySelector<HTMLElement>('[data-necromancy="content"]');
  }

  onBuy(handler: (upgradeId: string) => void): void {
    this.buyHandler = handler;
  }

  /** Red shake when a purchase is rejected (affordability went stale). */
  notifyDenied(upgradeId: string): void {
    const row = this.rows.get(upgradeId);
    if (row === undefined) return;
    row.root.classList.remove('is-denied');
    void row.root.offsetWidth;
    row.root.classList.add('is-denied');
  }

  render(
    payload: NecromancyChangedPayload,
    stocks: BuildingStocks,
    unlocked: boolean,
    lockedProgress?: { current: number; goal: number },
  ): void {
    if (this.panelEl !== null) this.panelEl.classList.toggle('panel-locked', !unlocked);
    if (this.lockedEl !== null) {
      this.lockedEl.hidden = unlocked;
      // Show progress toward the gate so the locked state isn't a dead end.
      if (!unlocked && lockedProgress !== undefined) {
        this.lockedEl.textContent =
          `Locked — conquests ${formatNumber(lockedProgress.current)} / ` +
          `${formatNumber(lockedProgress.goal)}. The dead share their secrets after four.`;
      }
    }
    if (this.contentEl !== null) this.contentEl.hidden = !unlocked;
    if (!unlocked) return;

    for (const item of payload.upgrades) {
      const row = this.ensureRow(item);
      const maxed = item.level >= item.maxLevel;

      row.chip.textContent = item.level > 0 ? `Lv ${item.level}` : '';
      row.chip.hidden = item.level === 0; // no empty grey pill on unresearched rows
      row.description.textContent = item.description;
      row.effect.textContent = item.effectText;
      row.effect.hidden = item.effectText === '';
      row.flavor.textContent = item.flavor;
      // Maxed rows get their own "done" tint instead of looking unaffordable.
      row.root.classList.toggle('is-owned', maxed);

      this.renderCosts(row.cost, item.nextCosts, stocks);

      if (maxed) {
        row.buyButton.textContent = item.maxLevel === 1 ? 'DONE' : 'MAX';
        row.buyButton.disabled = true;
      } else {
        // Cost chips inside the card carry the price; the button stays
        // short so narrow Crypt columns never overflow.
        row.buyButton.textContent = item.level === 0 ? 'RESEARCH' : 'UPGRADE';
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
    costs: readonly BuildingCostEntry[],
    stocks: BuildingStocks,
  ): void {
    container.replaceChildren();
    for (const entry of costs) {
      const part = document.createElement('span');
      const affordable = this.stockOf(stocks, entry.currency) >= entry.amount;
      part.className = `cost-part ${affordable ? 'is-ok' : 'is-short'}`;
      part.title = CURRENCY_TITLES[entry.currency] ?? entry.currency;
      part.textContent = `${CURRENCY_ICONS[entry.currency] ?? ''}${formatNumber(entry.amount)}`;
      container.append(part);
    }
  }

  private ensureRow(item: NecromancyChangedPayload['upgrades'][number]): Row {
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
    buyButton.textContent = 'RESEARCH';
    buyButton.addEventListener('click', () => this.buyHandler?.(item.id));

    container.append(main, buyButton);
    this.listEl.appendChild(container);

    row = { root: container, chip, description, effect, flavor, cost, buyButton };
    this.rows.set(item.id, row);
    return row;
  }
}

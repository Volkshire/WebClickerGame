import { formatNumber } from '../../ui/format';
import {
  GENERATORS,
  GENERATOR_REVEAL_FACTOR,
  revealedGeneratorIds,
} from './generators';
import type { ClickerChangedPayload } from './types';

interface ShopItem {
  id: string;
  name: string;
  cost: number;
  effectText: string;
  flavor?: string;
}

interface Row {
  root: HTMLDivElement;
  chip: HTMLElement;
  effect: HTMLElement;
  flavor: HTMLElement;
  buyButton: HTMLButtonElement;
}

const FLASH_MS = 500;
const OFFLINE_TOAST_MS = 4000;
const GAIN_PULSE_MS = 340;

export class ClickerView {
  private readonly soulsLabel: HTMLElement;
  private readonly clicksLabel: HTMLElement;
  private readonly perClickLabel: HTMLElement;
  private readonly perSecondLabel: HTMLElement;
  private readonly buttonEl: HTMLButtonElement;
  private readonly upgradeListEl: HTMLElement;
  private readonly generatorListEl: HTMLElement;
  private readonly upgradeRows = new Map<string, Row>();
  private readonly generatorRows = new Map<string, Row>();
  private readonly teasers = new Map<HTMLElement, HTMLElement>();
  private readonly previousCounts = new Map<string, number>();
  private readonly flashTimers = new Map<string, number>();
  private readonly offlineToastEl: HTMLElement;
  private offlineToastTimer: number | null = null;
  private gainPulseTimer: number | null = null;
  private readonly statsSoulsLabel: HTMLElement | null;
  private readonly statsClickLabel: HTMLElement | null;
  private readonly statsSecLabel: HTMLElement | null;
  private readonly productionListEl: HTMLElement | null;
  private readonly harvestBonusRow: HTMLElement | null;
  private readonly harvestBonusText: HTMLElement | null;
  private buyUpgradeHandler: ((upgradeId: string) => void) | null = null;
  private buyGeneratorHandler: ((generatorId: string) => void) | null = null;
  private currentPerClick = 1;
  private lastProductionSignature: string | null = null;

  constructor(root: ParentNode) {
    const souls = root.querySelector<HTMLElement>('[data-clicker="souls"]');
    const clicks = root.querySelector<HTMLElement>('[data-clicker="total-clicks"]');
    const perClick = root.querySelector<HTMLElement>('[data-clicker="per-click"]');
    const perSecond = root.querySelector<HTMLElement>('[data-clicker="per-second"]');
    const button = root.querySelector<HTMLButtonElement>('[data-clicker="harvest"]');
    const upgradeList = root.querySelector<HTMLElement>('[data-clicker="upgrades"]');
    const generatorList = root.querySelector<HTMLElement>('[data-clicker="generators"]');
    const offlineToast = root.querySelector<HTMLElement>('[data-clicker="offline-toast"]');

    if (souls === null) throw new Error('clicker element [data-clicker="souls"] not found');
    if (clicks === null) throw new Error('clicker element [data-clicker="total-clicks"] not found');
    if (perClick === null) throw new Error('clicker element [data-clicker="per-click"] not found');
    if (perSecond === null) throw new Error('clicker element [data-clicker="per-second"] not found');
    if (button === null) throw new Error('clicker element [data-clicker="harvest"] not found');
    if (upgradeList === null) throw new Error('clicker element [data-clicker="upgrades"] not found');
    if (generatorList === null) throw new Error('clicker element [data-clicker="generators"] not found');
    if (offlineToast === null) throw new Error('clicker element [data-clicker="offline-toast"] not found');

    this.soulsLabel = souls;
    this.clicksLabel = clicks;
    this.perClickLabel = perClick;
    this.perSecondLabel = perSecond;
    this.buttonEl = button;
    this.upgradeListEl = upgradeList;
    this.generatorListEl = generatorList;
    this.offlineToastEl = offlineToast;

    // Optional dashboard panels — absent elements simply skip their update.
    this.statsSoulsLabel = root.querySelector<HTMLElement>('[data-clicker="stats-souls"]');
    this.statsClickLabel = root.querySelector<HTMLElement>('[data-clicker="stats-click"]');
    this.statsSecLabel = root.querySelector<HTMLElement>('[data-clicker="stats-sec"]');
    this.productionListEl = root.querySelector<HTMLElement>('[data-clicker="production"]');
    this.harvestBonusRow = root.querySelector<HTMLElement>('[data-clicker="harvest-bonus"]');
    this.harvestBonusText = root.querySelector<HTMLElement>('[data-clicker="harvest-bonus-text"]');

    button.addEventListener('click', this.spawnGainFeedback);
  }

  get button(): HTMLButtonElement {
    return this.buttonEl;
  }

  onBuyUpgrade(handler: (upgradeId: string) => void): void {
    this.buyUpgradeHandler = handler;
  }

  onBuyGenerator(handler: (generatorId: string) => void): void {
    this.buyGeneratorHandler = handler;
  }

  /** Red shake when a purchase is rejected (affordability went stale). */
  notifyDenied(id: string): void {
    const row = this.upgradeRows.get(id) ?? this.generatorRows.get(id);
    if (row === undefined) return;
    row.root.classList.remove('is-denied');
    void row.root.offsetWidth;
    row.root.classList.add('is-denied');
  }

  showOfflineGain(amount: number): void {
    if (this.offlineToastTimer !== null) clearTimeout(this.offlineToastTimer);

    this.offlineToastEl.textContent = `While you were away: +${formatNumber(amount)} Souls`;
    this.offlineToastEl.hidden = false;

    this.offlineToastTimer = window.setTimeout(() => {
      this.offlineToastEl.hidden = true;
      this.offlineToastTimer = null;
    }, OFFLINE_TOAST_MS);
  }

  render(payload: ClickerChangedPayload): void {
    this.currentPerClick = payload.soulsPerClick;

    this.soulsLabel.textContent = formatNumber(payload.souls);
    this.clicksLabel.textContent = formatNumber(payload.totalClicks);
    this.perClickLabel.textContent = formatNumber(payload.soulsPerClick);
    this.perSecondLabel.textContent = formatNumber(payload.soulsPerSecond);

    if (this.statsSoulsLabel !== null) this.statsSoulsLabel.textContent = formatNumber(payload.souls);
    if (this.statsClickLabel !== null) this.statsClickLabel.textContent = formatNumber(payload.soulsPerClick);
    if (this.statsSecLabel !== null) this.statsSecLabel.textContent = formatNumber(payload.soulsPerSecond);
    if (this.productionListEl !== null) this.renderProduction(payload);

    if (this.harvestBonusRow !== null && this.harvestBonusText !== null) {
      const mult = payload.harvestMultiplier;
      if (mult > 1) {
        this.harvestBonusRow.hidden = false;
        this.harvestBonusText.textContent = `×${formatNumber(mult)} from Prestige`;
      } else {
        this.harvestBonusRow.hidden = true;
      }
    }

    this.renderShop(
      this.upgradeRows,
      this.upgradeListEl,
      payload.souls,
      payload.upgrades,
      (item) => item.level,
      (count) => `Lv ${count}`,
      (id) => this.buyUpgradeHandler?.(id),
    );

    // Generators route through the SHARED reveal function — the exact same
    // source of truth ClickerSystem uses for Dark Infrastructure grants.
    const ownedMap: Record<string, number> = {};
    for (const generator of payload.generators) ownedMap[generator.id] = generator.owned;
    this.renderShop(
      this.generatorRows,
      this.generatorListEl,
      payload.souls,
      payload.generators,
      (item) => item.owned,
      (count) => `Owned ${formatNumber(count)}`,
      (id) => this.buyGeneratorHandler?.(id),
      revealedGeneratorIds(payload.souls, ownedMap),
    );
  }

  /** Per-generator production breakdown, derived from defs × owned counts. */
  private renderProduction(payload: ClickerChangedPayload): void {
    const active: { name: string; owned: number; rate: number }[] = [];
    for (const generator of payload.generators) {
      if (generator.owned <= 0) continue;
      const def = GENERATORS.find((entry) => entry.id === generator.id);
      if (def === undefined) continue;
      active.push({
        name: def.name,
        owned: generator.owned,
        rate: def.productionPerSecond * generator.owned,
      });
    }

    // Owned counts fully determine every rendered value; skip the DOM
    // rebuild unless one actually changed (publishes fire per soul tick).
    const signature = active.map((row) => `${row.name}:${row.owned}`).join('|');
    if (signature === this.lastProductionSignature) return;
    this.lastProductionSignature = signature;

    const list = this.productionListEl!;
    list.replaceChildren();

    if (active.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'breakdown-empty';
      empty.textContent = 'No generators yet — raise one to start producing.';
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of active) {
      const li = document.createElement('li');
      li.className = 'breakdown-row';
      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = `${row.name} ×${formatNumber(row.owned)}`;
      const value = document.createElement('span');
      value.className = 'stat-value';
      value.textContent = `+${formatNumber(row.rate)}/sec`;
      li.append(label, value);
      fragment.appendChild(li);
    }
    list.appendChild(fragment);
  }

  private renderShop<T extends ShopItem>(
    rows: Map<string, Row>,
    listEl: HTMLElement,
    souls: number,
    items: readonly T[],
    countOf: (item: T) => number,
    chipLabel: (count: number) => string,
    buy: (id: string) => void,
    /** Precomputed reveal set; generators MUST pass the shared source of truth. */
    revealedOverride?: Set<string>,
  ): void {
    const revealed =
      revealedOverride ??
      (() => {
        const firstUnownedId = items.find((item) => countOf(item) === 0)?.id ?? null;
        // Upgrade rows keep the same three reveal rules locally (no gameplay
        // system hooks upgrades, so a shared extraction buys nothing there).
        // The peek divisor is shared so tuning one shop tunes both.
        const set = new Set<string>();
        for (const item of items) {
          if (
            countOf(item) > 0 ||
            item.id === firstUnownedId ||
            souls * GENERATOR_REVEAL_FACTOR >= item.cost
          ) {
            set.add(item.id);
          }
        }
        return set;
      })();

    let lockedCount = 0;
    for (const item of items) {
      // A balance drop (Prestige above all) can UN-reveal an item; its stale
      // row must leave the DOM instead of staying latched forever.
      if (!revealed.has(item.id)) lockedCount += 1;
    }

    for (const item of items) {
      if (!revealed.has(item.id)) {
        this.retractRow(rows, item.id);
        continue;
      }

      const row = this.ensureRow(rows, listEl, item.id, item.name, buy);
      const count = countOf(item);

      const previous = this.previousCounts.get(item.id);
      if (previous !== undefined && count > previous) this.flashRow(row, item.id);
      this.previousCounts.set(item.id, count);

      this.setText(row.chip, chipLabel(count));
      this.setText(row.effect, item.effectText);
      row.effect.hidden = item.effectText === '';
      this.setText(row.flavor, item.flavor ?? '');
      row.flavor.hidden = item.flavor === undefined;
      this.setText(row.buyButton, `BUY · ${formatNumber(item.cost)}`);

      const affordable = souls >= item.cost;
      row.buyButton.disabled = !affordable;
      row.root.classList.toggle('is-affordable', affordable);
    }

    // Enforce visual order: rows must render in definition order even when
    // their DOM nodes were created after the locked-items teaser. Only move
    // rows that are actually out of place — re-appending an attached node
    // detaches it, which clears hover/click state on it every soul tick.
    let previousRow: HTMLDivElement | null = null;
    for (const item of items) {
      if (!revealed.has(item.id)) continue;
      const row = rows.get(item.id);
      if (row === undefined) continue;
      if (row.root.previousElementSibling !== previousRow) {
        listEl.insertBefore(
          row.root,
          previousRow !== null ? previousRow.nextElementSibling : listEl.firstElementChild,
        );
      }
      previousRow = row.root;
    }

    this.updateTeaser(listEl, lockedCount);
  }

  private ensureRow(
    rows: Map<string, Row>,
    listEl: HTMLElement,
    id: string,
    name: string,
    buy: (id: string) => void,
  ): Row {
    let row = rows.get(id);
    if (row !== undefined) return row;

    const container = document.createElement('div');
    container.className = 'item-row';

    const main = document.createElement('div');
    main.className = 'item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = name;

    const chip = document.createElement('em');
    chip.className = 'item-chip';
    nameEl.appendChild(chip);

    const effect = document.createElement('span');
    effect.className = 'item-effect';
    effect.hidden = true;

    const flavor = document.createElement('span');
    flavor.className = 'item-flavor';
    flavor.hidden = true;

    main.append(nameEl, effect, flavor);

    const buyButton = document.createElement('button');
    buyButton.type = 'button';
    buyButton.className = 'buy-button';
    buyButton.textContent = 'BUY';
    buyButton.addEventListener('click', () => buy(id));

    container.append(main, buyButton);
    // New rows slot in above the locked-items teaser so the teaser stays last
    // without any re-pinning on subsequent renders.
    listEl.insertBefore(container, this.teasers.get(listEl) ?? null);

    row = { root: container, chip, effect, flavor, buyButton };
    rows.set(id, row);
    return row;
  }

  /** Removes a row that fell out of the reveal set, with all its view state. */
  private retractRow(rows: Map<string, Row>, id: string): void {
    const row = rows.get(id);
    if (row === undefined) return;
    row.root.remove();
    rows.delete(id);
    this.previousCounts.delete(id);
    const timer = this.flashTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.flashTimers.delete(id);
    }
  }

  /** textContent write that no-ops when unchanged (avoids layout churn). */
  private setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  private updateTeaser(listEl: HTMLElement, lockedCount: number): void {
    if (lockedCount <= 0) {
      const existing = this.teasers.get(listEl);
      if (existing !== undefined) {
        existing.remove();
        this.teasers.delete(listEl);
      }
      return;
    }

    let teaser = this.teasers.get(listEl);
    if (teaser === undefined) {
      teaser = document.createElement('div');
      teaser.className = 'item-teaser';
      this.teasers.set(listEl, teaser);
    }
    // Pin only when actually misplaced — re-appending an attached node
    // detaches it and resets its hover/focus state.
    if (teaser.parentElement !== listEl || listEl.lastElementChild !== teaser) {
      listEl.appendChild(teaser);
    }
    this.setText(teaser, `🔒 ??? · ${lockedCount} more locked`);
  }

  private flashRow(row: Row, id: string): void {
    row.root.classList.remove('is-flash');
    void row.root.offsetWidth;
    row.root.classList.add('is-flash');

    const existingTimer = this.flashTimers.get(id);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const timer = window.setTimeout(() => {
      row.root.classList.remove('is-flash');
      this.flashTimers.delete(id);
    }, FLASH_MS);
    this.flashTimers.set(id, timer);
  }

  /**
   * Click feedback: floating "+X Souls" (actual per-click amount), a glow
   * burst ring, and a brief pulse on the soul counter. Pure presentation —
   * the soul math lives in ClickerSystem's own click listener.
   */
  private spawnGainFeedback = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anchor = this.buttonEl.parentElement;
    if (anchor === null) return;

    // Floating gain number, capped so rapid clicking cannot pile up DOM nodes.
    if (anchor.querySelectorAll('.float-gain').length < 12) {
      const floater = document.createElement('span');
      floater.className = 'float-gain';
      floater.textContent = `+${formatNumber(this.currentPerClick)} Souls`;
      floater.style.left = `${50 + (Math.random() * 30 - 15)}%`;
      floater.style.setProperty('--drift', `${(Math.random() * 26 - 13).toFixed(1)}px`);
      floater.addEventListener('animationend', () => floater.remove());
      anchor.appendChild(floater);
    }

    // Expanding glow-burst ring from the button center.
    if (anchor.querySelectorAll('.harvest-burst').length < 6) {
      const burst = document.createElement('span');
      burst.className = 'harvest-burst';
      burst.addEventListener('animationend', () => burst.remove());
      anchor.appendChild(burst);
    }

    // Brief pulse on the big soul number itself.
    this.soulsLabel.classList.remove('is-gained');
    void this.soulsLabel.offsetWidth;
    this.soulsLabel.classList.add('is-gained');
    if (this.gainPulseTimer !== null) clearTimeout(this.gainPulseTimer);
    this.gainPulseTimer = window.setTimeout(() => {
      this.soulsLabel.classList.remove('is-gained');
      this.gainPulseTimer = null;
    }, GAIN_PULSE_MS);
  };
}

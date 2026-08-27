import { formatNumber } from '../../ui/format';
import type { LegionChangedPayload } from './types';
import type { ResourceId } from '../resources/types';
import { payableCount } from './afford';
import type { ResourceStocks } from './afford';
import type { UnitDefinition } from './units';
import { UNIT_DEFS, getUnitDef } from './units';
import type { UnitTag, UnitType } from '../combat/unitTypes';
import { UNIT_TAGS } from '../combat/unitTypes';

interface UnitRow {
  root: HTMLDivElement;
  chip: HTMLElement;
  effect: HTMLElement;
  raiseButton: HTMLButtonElement;
  amountButtons: HTMLButtonElement[];
}

const AMOUNTS = [1, 10, 100, 1000, Number.POSITIVE_INFINITY] as const;
const AMOUNT_LABELS = ['×1', '×10', '×100', '×1000', 'MAX'] as const;
const DEFAULT_AMOUNT_INDEX = 0;

const RESOURCE_ICONS: Record<ResourceId, string> = {
  bone: '🦴',
  flesh: '🍖',
  iron: '⚙️',
};
const RESOURCE_TITLES: Record<ResourceId, string> = {
  bone: 'Bone',
  flesh: 'Flesh',
  iron: 'Iron',
};

const FLASH_MS = 500;

export class LegionView {
  private readonly unitsListEl: HTMLElement;
  private readonly resourcesLabel: HTMLElement;
  private readonly summaryLabel: HTMLElement;
  private readonly rows = new Map<string, UnitRow>();
  private readonly selectedAmounts = new Map<string, number>();
  private readonly previousCounts = new Map<string, number>();
  private readonly flashTimers = new Map<string, number>();
  private raiseHandler: ((unitId: string, amount: number) => void) | null = null;
  private lastPayload: LegionChangedPayload | null = null;
  private lastStocks: ResourceStocks = { souls: 0, bone: 0, flesh: 0, iron: 0 };
  private readonly statsTotalEl: HTMLElement | null;
  private readonly statsPowerEl: HTMLElement | null;
  private readonly essenceListEl: HTMLElement | null;
  private readonly disciplineListEl: HTMLElement | null;
  private readonly unitsListStatsEl: HTMLElement | null;
  private lastUnits = 0;
  private lastPower = 0;

  constructor(root: ParentNode) {
    const unitsList = root.querySelector<HTMLElement>('[data-legion="units"]');
    const resourcesLabel = root.querySelector<HTMLElement>('[data-legion="resources"]');
    const summaryLabel = root.querySelector<HTMLElement>('[data-legion="summary"]');

    if (unitsList === null) throw new Error('legion element [data-legion="units"] not found');
    if (resourcesLabel === null) {
      throw new Error('legion element [data-legion="resources"] not found');
    }
    if (summaryLabel === null) throw new Error('legion element [data-legion="summary"] not found');

    this.unitsListEl = unitsList;
    this.resourcesLabel = resourcesLabel;
    this.summaryLabel = summaryLabel;

    // Optional dashboard panels — absent elements simply skip their update.
    this.statsTotalEl = root.querySelector<HTMLElement>('[data-legion-stats="total"]');
    this.statsPowerEl = root.querySelector<HTMLElement>('[data-legion-stats="power"]');
    this.essenceListEl = root.querySelector<HTMLElement>('[data-legion-stats="essence"]');
    this.disciplineListEl = root.querySelector<HTMLElement>('[data-legion-stats="discipline"]');
    this.unitsListStatsEl = root.querySelector<HTMLElement>('[data-legion-stats="units"]');
  }

  onRaise(handler: (unitId: string, amount: number) => void): void {
    this.raiseHandler = handler;
  }

  /** Red shake when a raise cannot be paid (affordability went stale). */
  notifyRaiseDenied(unitId: string): void {
    const row = this.rows.get(unitId);
    if (row === undefined) return;
    row.root.classList.remove('is-denied');
    void row.root.offsetWidth;
    row.root.classList.add('is-denied');
  }

  render(
    payload: LegionChangedPayload,
    souls: number,
    bone: number,
    flesh: number,
    iron: number,
  ): void {
    this.lastPayload = payload;
    this.lastStocks = { souls, bone, flesh, iron };

    // Pane visibility belongs to the TabController; unlock state only gates
    // the content below (and locks the tab itself via main.ts).

    this.resourcesLabel.textContent =
      payload.unlocked
        ? `Bone ${formatNumber(bone)} · Flesh ${formatNumber(flesh)} · Iron ${formatNumber(iron)}`
        : '';

    if (!payload.unlocked) {
      this.unitsListEl.replaceChildren();
      this.rows.clear();
      this.previousCounts.clear();
      this.summaryLabel.textContent = '';
      return;
    }

    let totalUnits = 0;
    let totalPower = 0;
    const essencePower = new Map<string, number>();
    const disciplineUnits = new Map<string, number>();
    const unitCounts: { name: string; count: number }[] = [];
    for (const def of UNIT_DEFS) {
      if (!this.isVisible(payload, def.id)) continue;
      const count = this.countOf(payload, def.id);
      totalUnits += count;
      totalPower += count * def.combatPower;
      if (count > 0) unitCounts.push({ name: def.name, count });
      if (count <= 0) continue;
      const power = count * def.combatPower;
      for (const tag of def.tags) {
        essencePower.set(tag, (essencePower.get(tag) ?? 0) + power);
      }
      disciplineUnits.set(def.type, (disciplineUnits.get(def.type) ?? 0) + count);
    }
    this.summaryLabel.textContent =
      `Undead ${formatNumber(totalUnits)} · Army Power ${formatNumber(totalPower)}`;
    this.lastUnits = totalUnits;
    this.lastPower = totalPower;

    this.renderArmyStats(essencePower, disciplineUnits, unitCounts);

    const renderedIds = new Set<string>();
    for (const def of UNIT_DEFS) {
      if (!this.isVisible(payload, def.id)) {
        this.removeRow(def.id);
        continue;
      }
      renderedIds.add(def.id);
      const row = this.ensureRow(def);
      const tierLocked = this.tierLockedOf(def, payload);

      const count = this.countOf(payload, def.id);
      const previous = this.previousCounts.get(def.id);
      if (previous !== undefined && count > previous) this.flashRow(row, def.id);
      this.previousCounts.set(def.id, count);

      row.chip.textContent = `Owned ${formatNumber(count)}`;
      this.renderCost(row.effect, def);

      if (tierLocked) {
        row.raiseButton.disabled = true;
        row.raiseButton.textContent = 'LOCKED';
        row.root.classList.add('is-locked');
        row.root.classList.remove('is-affordable');
        // Amount buttons are NOT unconditionally disabled;
        // affordability will be checked below. We do not continue
        // so the amount button affordability checks can run.
      }

      const selectedIndex = this.selectedAmounts.get(def.id) ?? DEFAULT_AMOUNT_INDEX;
      const selectedAmount = AMOUNTS[selectedIndex];
      const payableTotal = payableCount(def, this.lastStocks);

      // Fourth arg is the affordability cap (the third is an optional cost
      // multiplier the view does not know about; previews use base costs).
      const coversSelection =
      payableCount(def, this.lastStocks, 1, selectedAmount) >=
      (Number.isFinite(selectedAmount) ? selectedAmount : 1);

      for (let index = 0; index < row.amountButtons.length; index += 1) {
        const amountOption = AMOUNTS[index];
        const needed = Number.isFinite(amountOption) ? amountOption : 1;
        const affordableOption =
          payableCount(def, this.lastStocks, 1, amountOption) >= needed;
        row.amountButtons[index].classList.toggle('is-unpayable', !affordableOption);
        row.amountButtons[index].classList.toggle('is-active', index === selectedIndex);
      }

      if (!tierLocked) {
        row.raiseButton.disabled = !coversSelection;
        row.raiseButton.textContent = 'RAISE';
      }
      if (!tierLocked) row.root.classList.remove('is-locked');
      row.root.classList.toggle('is-affordable', payableTotal > 0);
    }

    // Reconcile: drop rows whose unit left the roster definition entirely
    // (otherwise removed defs would linger like the old reveal-latch bug).
    for (const id of Array.from(this.rows.keys())) {
      if (!renderedIds.has(id)) this.removeRow(id);
    }
  }

  /** Fills the center "Your Legion" dashboard panel (null-guarded). */
  private renderArmyStats(
    essencePower: Map<string, number>,
    disciplineUnits: Map<string, number>,
    unitCounts: { name: string; count: number }[],
  ): void {
    if (this.statsTotalEl !== null) this.statsTotalEl.textContent = formatNumber(this.lastUnits);
    if (this.statsPowerEl !== null) this.statsPowerEl.textContent = formatNumber(this.lastPower);

    const essenceLabels: Record<UnitTag, string> = {
      spirit: 'Spirit',
      bone: 'Bone',
      flesh: 'Flesh',
      armored: 'Armored',
      soul: 'Soul',
    };
    this.renderBreakdown(
      this.essenceListEl,
      UNIT_TAGS.map((tag) => [
        essenceLabels[tag],
        `${formatNumber(essencePower.get(tag) ?? 0)} power`,
      ]),
    );

    const typeLabels: Record<UnitType, string> = { melee: 'Melee', ranged: 'Ranged' };
    this.renderBreakdown(
      this.disciplineListEl,
      (Object.keys(typeLabels) as UnitType[]).map((type) => [
        typeLabels[type],
        `${formatNumber(disciplineUnits.get(type) ?? 0)} undead`,
      ]),
    );

    this.renderBreakdown(
      this.unitsListStatsEl,
      unitCounts.map((u) => [u.name, formatNumber(u.count)]),
      'No undead yet — raise one below.',
    );
  }

  private renderBreakdown(
    list: HTMLElement | null,
    rows: [string, string][],
    emptyMessage?: string,
  ): void {
    if (list === null) return;
    list.replaceChildren();

    if (rows.length === 0 && emptyMessage !== undefined) {
      const empty = document.createElement('li');
      empty.className = 'breakdown-empty';
      empty.textContent = emptyMessage;
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const li = document.createElement('li');
      li.className = 'breakdown-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'stat-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'stat-value';
      valueEl.textContent = value;
      li.append(labelEl, valueEl);
      fragment.appendChild(li);
    }
    list.appendChild(fragment);
  }

  /**
   * Roster visibility straight from the definition: concealed units stay
   * hidden until their latch fires; teaser/always rows render.
   */
  private isVisible(payload: LegionChangedPayload, unitId: string): boolean {
    const def = getUnitDef(unitId);
    if (def !== null && def.reveal === 'concealed') {
      return payload.unlockedUnits[unitId] === true;
    }
    return true;
  }

  /** Reveal mode resolved against the runtime tier latches. */
  private tierLockedOf(def: UnitDefinition, payload: LegionChangedPayload): boolean {
    if (def.reveal === undefined || def.reveal === 'always') return false;
    return payload.unlockedUnits[def.id] !== true;
  }

  private countOf(payload: LegionChangedPayload, unitId: string): number {
    return payload.units[unitId] ?? 0;
  }

  private renderCost(effect: HTMLElement, def: UnitDefinition): void {
    effect.replaceChildren();
    effect.append(`Combat Power: ${formatNumber(def.combatPower)}`);

    const stocks = this.lastStocks;
    const soulPart = document.createElement('span');
    soulPart.className = `cost-part ${stocks.souls >= def.soulCost ? 'is-ok' : 'is-short'}`;
    soulPart.title = 'Souls';
    soulPart.textContent = ` ⚡${formatNumber(def.soulCost)}`;
    effect.append(soulPart);

    for (const [resourceId, amount] of Object.entries(def.resourceCosts)) {
      const cost = amount ?? 0;
      if (cost <= 0) continue;
      const id = resourceId as ResourceId;
      const part = document.createElement('span');
      part.className = `cost-part ${stocks[id] >= cost ? 'is-ok' : 'is-short'}`;
      part.title = RESOURCE_TITLES[id];
      part.textContent = `${RESOURCE_ICONS[id]}${formatNumber(cost)}`;
      effect.append(part);
    }
  }

  private removeRow(unitId: string): void {
    const row = this.rows.get(unitId);
    if (row === undefined) return;
    row.root.remove();
    this.rows.delete(unitId);
    this.previousCounts.delete(unitId);
    const timer = this.flashTimers.get(unitId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.flashTimers.delete(unitId);
    }
  }

  private ensureRow(def: UnitDefinition): UnitRow {
    const existing = this.rows.get(def.id);
    if (existing !== undefined) return existing;

    const container = document.createElement('div');
    container.className = 'item-row unit-row';

    const main = document.createElement('div');
    main.className = 'item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = def.name;

    const chip = document.createElement('em');
    chip.className = 'item-chip';
    nameEl.appendChild(chip);

    const effect = document.createElement('span');
    effect.className = 'item-effect';

    main.append(nameEl, effect);

    const actions = document.createElement('div');
    actions.className = 'unit-actions';

    const amountRow = document.createElement('div');
    amountRow.className = 'amount-row';
    amountRow.role = 'group';
    amountRow.setAttribute('aria-label', `${def.name} recruit amount`);

    const amountButtons: HTMLButtonElement[] = [];
    for (let index = 0; index < AMOUNT_LABELS.length; index += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'amount-button';
      button.textContent = AMOUNT_LABELS[index];
      button.addEventListener('click', () => {
        this.selectedAmounts.set(def.id, index);
        if (this.lastPayload !== null) {
          this.render(
            this.lastPayload,
            this.lastStocks.souls,
            this.lastStocks.bone,
            this.lastStocks.flesh,
            this.lastStocks.iron,
          );
        }
      });
      amountRow.appendChild(button);
      amountButtons.push(button);
    }

    const raiseButton = document.createElement('button');
    raiseButton.type = 'button';
    raiseButton.className = 'buy-button';
    raiseButton.textContent = 'RAISE';
    raiseButton.addEventListener('click', () => {
      const amountIndex = this.selectedAmounts.get(def.id) ?? DEFAULT_AMOUNT_INDEX;
      const amount = AMOUNTS[amountIndex];
      const capped = Number.isFinite(amount)
        ? amount
        : payableCount(def, this.lastStocks);
      if (capped >= 1) this.raiseHandler?.(def.id, capped);
    });

    actions.append(amountRow, raiseButton);
    container.append(main, actions);
    this.unitsListEl.appendChild(container);

    const row: UnitRow = { root: container, chip, effect, raiseButton, amountButtons };
    this.rows.set(def.id, row);
    return row;
  }

  private flashRow(row: UnitRow, id: string): void {
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
}

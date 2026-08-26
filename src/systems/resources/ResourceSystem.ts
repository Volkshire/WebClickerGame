import { AppEvents } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { ResourceEvents, isResourceId } from './types';
import type { ResourceAmounts, ResourceChangedPayload, ResourceId } from './types';

const INITIAL_AMOUNTS: ResourceAmounts = { bone: 0, flesh: 0, iron: 0 };

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseSavedAmounts(raw: unknown): ResourceAmounts | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;
  const bone = record['bone'] === undefined || record['bone'] === null ? 0 : record['bone'];
  const flesh = record['flesh'] === undefined || record['flesh'] === null ? 0 : record['flesh'];
  if (!isValidCount(bone) || !isValidCount(flesh)) return null;
  // Iron arrived after the first release; older saves without it (or with null) start at 0.
  const iron = record['iron'] === undefined || record['iron'] === null ? 0 : record['iron'];
  if (!isValidCount(iron)) return null;
  return { bone, flesh, iron };
}

export class ResourceSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private amounts: ResourceAmounts = { ...INITIAL_AMOUNTS };

  constructor(events: EventBus, saves: SaveManager) {
    this.events = events;
    this.saves = saves;

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  getAmount(resourceId: ResourceId): number {
    if (!isResourceId(resourceId)) return 0;
    return this.amounts[resourceId];
  }

  grant(resourceId: ResourceId, amount: number): boolean {
    if (!isResourceId(resourceId)) return false;
    if (!Number.isSafeInteger(amount) || amount <= 0) return false;

    this.amounts[resourceId] += amount;
    this.save();
    this.publish();
    return true;
  }

  spend(resourceId: ResourceId, amount: number): boolean {
    if (!isResourceId(resourceId)) return false;
    if (!Number.isSafeInteger(amount) || amount <= 0) return false;
    if (this.amounts[resourceId] < amount) return false;

    this.amounts[resourceId] -= amount;
    this.save();
    this.publish();
    return true;
  }

  restore(): boolean {
    const parsed = parseSavedAmounts(this.saves.load());
    if (parsed !== null) this.amounts = parsed;
    this.publish();
    return parsed !== null;
  }

  /** Prestige support: wipes all stockpiled resources. */
  resetRun(): void {
    this.amounts = { ...INITIAL_AMOUNTS };
    this.save();
    this.publish();
  }

  private save(): void {
    this.saves.save({
      v: SAVE_SCHEMA_VERSION,
      bone: this.amounts.bone,
      flesh: this.amounts.flesh,
      iron: this.amounts.iron,
    });
  }

  private publish(): void {
    const payload: ResourceChangedPayload = {
      bone: this.amounts.bone,
      flesh: this.amounts.flesh,
      iron: this.amounts.iron,
    };
    this.events.emit<ResourceChangedPayload>(ResourceEvents.Changed, payload);
  }
}

import { AppEvents } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { NECROMANCY_UPGRADES, necromancyCostAt } from './necromancy';
import { NecromancyEvents } from './types';
import type {
  BuildingCostEntry,
  NecromancyChangedPayload,
  NecromancyState,
  NecromancyUpgradeRow,
} from './types';

/**
 * Debits the purchase price. Implemented by the wiring layer so this
 * system never depends on how currencies are stored.
 */
export interface NecromancyTransactor {
  canAfford(costs: Record<string, number>): boolean;
  spend(costs: Record<string, number>): boolean;
}

export interface NecromancySystemOptions {
  transactor: NecromancyTransactor;
}

// NOTE: never hand a shared default-state object out of parseSavedState —
// instances would alias and mutate one object across the process.

function parseSavedState(raw: unknown): NecromancyState | null {
  // Fresh object EVERY time: handing back the shared INITIAL_STATE here
  // would alias one mutable object across every empty-storage instance.
  if (raw === null || raw === undefined) return { levels: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;
  const rawLevels = record['levels'] ?? record; // tolerate flat legacy blobs
  if (typeof rawLevels !== 'object' || rawLevels === null || Array.isArray(rawLevels)) {
    return null;
  }
  const levels: Record<string, number> = {};
  for (const [id, value] of Object.entries(rawLevels as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    levels[id] = value;
  }
  return { levels };
}

/**
 * Owns Necromancy research: purchase state and persistence. Run-scoped —
 * the Crypt's secrets reset with every Prestige like its buildings.
 */
export class NecromancySystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private readonly transactor: NecromancyTransactor;
  private state: NecromancyState = { levels: {} };

  constructor(events: EventBus, saves: SaveManager, options: NecromancySystemOptions) {
    this.events = events;
    this.saves = saves;
    this.transactor = options.transactor;

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  levelOf(upgradeId: string): number {
    return this.state.levels[upgradeId] ?? 0;
  }

  isOwned(upgradeId: string): boolean {
    return this.levelOf(upgradeId) > 0;
  }

  buy(upgradeId: string): boolean {
    const definition = NECROMANCY_UPGRADES.find((entry) => entry.id === upgradeId);
    if (definition === undefined) return false;

    const level = this.levelOf(upgradeId);
    if (level >= definition.maxLevel) return false;

    const costs = necromancyCostAt(definition, level);
    if (!this.transactor.canAfford(costs)) return false;
    if (!this.transactor.spend(costs)) return false;

    this.state.levels[upgradeId] = level + 1;
    this.save();
    this.publish();
    return true;
  }

  restore(): void {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) this.state = parsed;
    this.publish();
  }

  /** Prestige support: research is run-scoped like every Crypt building. */
  resetRun(): void {
    this.state = { levels: {} };
    this.save();
    this.publish();
  }

  private save(): void {
    this.saves.save({ v: SAVE_SCHEMA_VERSION, levels: { ...this.state.levels } });
  }

  private publish(): void {
    const upgrades: NecromancyUpgradeRow[] = NECROMANCY_UPGRADES.map((definition) => {
      const level = this.levelOf(definition.id);
      const nextCosts: BuildingCostEntry[] = [];
      if (level < definition.maxLevel) {
        for (const [currency, amount] of Object.entries(necromancyCostAt(definition, level))) {
          nextCosts.push({
            currency: currency as BuildingCostEntry['currency'],
            amount: amount ?? 0,
          });
        }
      }
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        flavor: definition.flavor,
        effectText: definition.effectText(level),
        level,
        maxLevel: definition.maxLevel,
        nextCosts,
      };
    });

    const payload: NecromancyChangedPayload = { upgrades };
    this.events.emit<NecromancyChangedPayload>(NecromancyEvents.Changed, payload);
  }
}

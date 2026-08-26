import { AppEvents } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { AUTO_RAISE_INTERVAL_SECONDS, BUILDINGS, buildingCostAt } from './buildings';
import type { BuildingCosts } from './buildings';
import { BuildingEvents } from './types';
import type {
  BuildingCostEntry,
  BuildingViewRow,
  BuildingsChangedPayload,
  BuildingsState,
} from './types';

/** Passive resource amounts produced by buildings (Ossuary bone income). */
export type BuildingProduction = Partial<Record<'bone' | 'flesh' | 'iron', number>>;

/**
 * Debits the purchase price. Implemented by the wiring layer so this system
 * never depends on how Souls/resources are stored.
 */
export interface BuildingTransactor {
  canAfford(costs: BuildingCosts): boolean;
  spend(costs: BuildingCosts): boolean;
}

export interface BuildingSystemOptions {
  transactor: BuildingTransactor;
}

// NOTE: never hand a shared default-state object out of parseSavedState —
// instances would alias and mutate one object across the process.

function parseSavedState(raw: unknown): BuildingsState | null {
  // Fresh object EVERY time: handing back the shared INITIAL_STATE here
  // would alias one mutable object across every empty-storage instance,
  // silently carrying purchases between systems/tests.
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

/** Owns Crypt buildings: purchase state, persistence, the auto-raise beat and passive production. */
export class BuildingSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private readonly transactor: BuildingTransactor;
  private state: BuildingsState = { levels: {} };
  private autoRaiseTimer = 0;
  private productionCarry = 0;

  /** Wiring-provided hook that raises up to `count` wraiths. */
  private autoRaiseHook: ((count: number) => void) | null = null;
  /** Wiring-provided sink for whole-unit passive production (Ossuary bone). */
  private productionHook: ((amounts: BuildingProduction) => void) | null = null;

  constructor(events: EventBus, saves: SaveManager, options: BuildingSystemOptions) {
    this.events = events;
    this.saves = saves;
    this.transactor = options.transactor;

    events.on<{ deltaSeconds: number }>(AppEvents.Update, ({ deltaSeconds }) => {
      this.tick(deltaSeconds);
    });

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  /** Installs the auto-raise executor; called once by the wiring layer. */
  setAutoRaise(hook: (count: number) => void): void {
    this.autoRaiseHook = hook;
  }

  /** Installs the passive-production sink; called once by the wiring layer. */
  setProduction(hook: (amounts: BuildingProduction) => void): void {
    this.productionHook = hook;
  }

  levelOf(buildingId: string): number {
    return this.state.levels[buildingId] ?? 0;
  }

  isBuilt(buildingId: string): boolean {
    return this.levelOf(buildingId) > 0;
  }

  buy(buildingId: string): boolean {
    const definition = BUILDINGS.find((entry) => entry.id === buildingId);
    if (definition === undefined) return false;

    const level = this.levelOf(buildingId);
    if (level >= definition.maxLevel) return false;

    const costs = buildingCostAt(definition, level);
    if (!this.transactor.canAfford(costs)) return false;
    if (!this.transactor.spend(costs)) return false;

    this.state.levels[buildingId] = level + 1;
    this.save();
    this.publish();
    return true;
  }

  restore(): void {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) this.state = parsed;
    this.publish();
  }

  /** Prestige support: the Crypt is run-scoped and wipes with everything else. */
  resetRun(): void {
    this.state = { levels: {} };
    this.autoRaiseTimer = 0;
    this.productionCarry = 0;
    this.save();
    this.publish();
  }

  private tick(deltaSeconds: number): void {
    this.tickAutoRaise(deltaSeconds);
    this.tickProduction(deltaSeconds);
  }

  private tickAutoRaise(deltaSeconds: number): void {
    const level = this.levelOf('auto-raise');
    if (level <= 0 || this.autoRaiseHook === null) return;

    this.autoRaiseTimer += deltaSeconds;
    if (this.autoRaiseTimer < AUTO_RAISE_INTERVAL_SECONDS) return;
    this.autoRaiseTimer = 0;
    this.autoRaiseHook(level);
  }

  /**
   * Ossuary bone income: fractional carry accumulates per second of owned
   * level, and only WHOLE units are granted (same integer discipline as the
   * Soul generators) so resource balances never go fractional.
   */
  private tickProduction(deltaSeconds: number): void {
    const level = this.levelOf('ossuary');
    if (level <= 0 || this.productionHook === null || deltaSeconds <= 0) return;

    this.productionCarry += level * deltaSeconds;
    const whole = Math.floor(this.productionCarry);
    if (whole <= 0) return;

    this.productionCarry -= whole;
    this.productionHook({ bone: whole });
  }

  private save(): void {
    this.saves.save({ v: SAVE_SCHEMA_VERSION, levels: { ...this.state.levels } });
  }

  private publish(): void {
    const buildings: BuildingViewRow[] = BUILDINGS.map((definition) => {
      const level = this.levelOf(definition.id);
      const nextCosts: BuildingCostEntry[] = [];
      if (level < definition.maxLevel) {
        for (const [currency, amount] of Object.entries(
          buildingCostAt(definition, level),
        )) {
          nextCosts.push({ currency: currency as BuildingCostEntry['currency'], amount: amount ?? 0 });
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

    const payload: BuildingsChangedPayload = { buildings };
    this.events.emit<BuildingsChangedPayload>(BuildingEvents.Changed, payload);
  }
}

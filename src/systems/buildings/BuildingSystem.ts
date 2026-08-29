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

/** Passive resource amounts produced by buildings (Ossuary bone / Fleshworks flesh). */
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
  private fleshProductionCarry = 0;
  private skeletonAutoRaiseTimer = 0;

  /** Wiring-provided hook that raises up to `count` wraiths. */
  private autoRaiseHook: ((count: number) => void) | null = null;
  /** Wiring-provided sink for whole-unit passive production (Ossuary bone, Fleshworks flesh). */
  private productionHook: ((amounts: BuildingProduction) => void) | null = null;
  /** Wiring-provided hook that raises up to `count` skeletons (Ossuary Auto-Raiser). */
  private skeletonAutoRaiseHook: ((count: number) => void) | null = null;

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

  /** Installs the skeleton auto-raise executor (Ossuary Auto-Raiser). */
  setSkeletonAutoRaise(hook: (count: number) => void): void {
    this.skeletonAutoRaiseHook = hook;
  }

  levelOf(buildingId: string): number {
    return this.state.levels[buildingId] ?? 0;
  }

  isBuilt(buildingId: string): boolean {
    return this.levelOf(buildingId) > 0;
  }

  /** Returns true if the building's unlock requirement is met (or absent). */
  isUnlocked(buildingId: string): boolean {
    const definition = BUILDINGS.find((entry) => entry.id === buildingId);
    if (definition === undefined) return false;
    if (definition.unlockRequirement === undefined) return true;
    return (
      this.levelOf(definition.unlockRequirement.buildingId) >=
      definition.unlockRequirement.minLevel
    );
  }

  buy(buildingId: string): boolean {
    if (!this.isUnlocked(buildingId)) return false;

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

  restore(): boolean {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) this.state = parsed;
    this.publish();
    return parsed !== null;
  }

  /** Prestige support: the Crypt is run-scoped and wipes with everything else. */
  resetRun(): void {
    this.state = { levels: {} };
    this.autoRaiseTimer = 0;
    this.productionCarry = 0;
    this.fleshProductionCarry = 0;
    this.skeletonAutoRaiseTimer = 0;
    this.save();
    this.publish();
  }

  private tick(deltaSeconds: number): void {
    this.tickAutoRaise(deltaSeconds);
    this.tickProduction(deltaSeconds);
    this.tickFleshProduction(deltaSeconds);
    this.tickSkeletonAutoRaise(deltaSeconds);
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

  /**
   * Fleshworks flesh income: same integer-discipline pattern as Ossuary bone
   * production. Whole units only; fractional carry persists across ticks.
   */
  private tickFleshProduction(deltaSeconds: number): void {
    const level = this.levelOf('fleshworks');
    if (level <= 0 || this.productionHook === null || deltaSeconds <= 0) return;

    this.fleshProductionCarry += level * deltaSeconds;
    const whole = Math.floor(this.fleshProductionCarry);
    if (whole <= 0) return;

    this.fleshProductionCarry -= whole;
    this.productionHook({ flesh: whole });
  }

  /**
   * Ossuary Auto-Raiser: raises Skeletons on the same 5-second cadence as
   * the Wraith auto-raise. Production output — no per-unit resource cost.
   */
  private tickSkeletonAutoRaise(deltaSeconds: number): void {
    const level = this.levelOf('ossuary-auto-raiser');
    if (level <= 0 || this.skeletonAutoRaiseHook === null) return;

    this.skeletonAutoRaiseTimer += deltaSeconds;
    if (this.skeletonAutoRaiseTimer < AUTO_RAISE_INTERVAL_SECONDS) return;
    this.skeletonAutoRaiseTimer = 0;
    this.skeletonAutoRaiseHook(level);
  }

  private save(): void {
    this.saves.save({ v: SAVE_SCHEMA_VERSION, levels: { ...this.state.levels } });
  }

  private publish(): void {
    const buildings: BuildingViewRow[] = BUILDINGS.map((definition) => {
      const level = this.levelOf(definition.id);
      const unlocked = this.isUnlocked(definition.id);
      const nextCosts: BuildingCostEntry[] = [];
      if (unlocked && level < definition.maxLevel) {
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
        unlocked,
      };
    });

    const payload: BuildingsChangedPayload = { buildings };
    this.events.emit<BuildingsChangedPayload>(BuildingEvents.Changed, payload);
  }
}

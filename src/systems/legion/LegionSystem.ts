import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { AppEvents } from '../../core/Application';
import { takeFromArmy } from './deployment';
import { LegionEvents } from './types';
import type { ArmyUnitGroup, LegionChangedPayload, LegionState } from './types';
import { LEGION_UNLOCK_REQUIREMENT, UNIT_DEFS, getUnitDef } from './units';

/**
 * Save layout v2 stores troop counts and tier latches as maps keyed by unit
 * id, so adding a unit never touches persistence again. The legacy per-unit
 * fields are still PARSED (old saves keep working) and still WRITTEN in sync
 * (rolling back to an older build cannot corrupt a v2 save).
 */
interface LegionSaveBlob {
  v: number;
  unlocked: boolean;
  units?: Record<string, unknown>;
  unitUnlocks?: Record<string, unknown>;
  // Legacy mirrors (kept in sync on every save):
  wraiths?: number;
  skeletons?: number;
  zombies?: number;
  golems?: number;
  knights?: number;
  zombieUnlocked?: boolean;
  golemUnlocked?: boolean;
  knightUnlocked?: boolean;
}

/** Legacy count field names and the unit ids they map onto. */
const LEGACY_COUNT_KEYS = {
  wraiths: 'wraith',
  skeletons: 'skeleton',
  zombies: 'zombie',
  golems: 'flesh_golem',
  knights: 'death_knight',
} as const;

const LEGACY_UNLOCK_KEYS = {
  zombieUnlocked: 'zombie',
  golemUnlocked: 'flesh_golem',
  knightUnlocked: 'death_knight',
} as const;

function freshState(): LegionState {
  return { unlocked: false, units: {}, unlockedUnits: {} };
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseOptionalCount(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  return isValidCount(raw) ? raw : 0;
}

/**
 * Latch maps normalize leniently (anything non-true is false): a corrupt
 * flag can only re-lock a tier — never destroy troops or the unlock itself.
 */
function parseLatchMap(raw: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      map[id] = value === true;
    }
  }
  return map;
}

/**
 * Count maps are strict: any malformed entry rejects the whole blob so a
 * corrupted economy cannot half-load as zero.
 */
function parseStrictCountMap(raw: unknown): Record<string, number> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidCount(value)) return null;
    if (value > 0) map[id] = value; // zero entries are noise; drop them
  }
  return map;
}

function parseSavedState(raw: unknown): LegionState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;
  if (typeof record['unlocked'] !== 'boolean') return null;

  const state = freshState();
  state.unlocked = record['unlocked'];

  const rawUnits = record['units'];
  if (rawUnits !== undefined) {
    // v2 blob; malformed counts reject the save entirely.
    const units = parseStrictCountMap(rawUnits);
    if (units === null) return null;
    state.units = units;
    state.unlockedUnits = parseLatchMap(record['unitUnlocks']);
    return state;
  }

  // Legacy blob: requires the historical wraiths field (as before); fields
  // added after the wraith-only era default for ancient saves.
  if (!isValidCount(record['wraiths'])) return null;
  for (const [field, unitId] of Object.entries(LEGACY_COUNT_KEYS)) {
    const count = parseOptionalCount(record[field]);
    if (count > 0) state.units[unitId] = count;
  }
  for (const [field, unitId] of Object.entries(LEGACY_UNLOCK_KEYS)) {
    if (record[field] === true) state.unlockedUnits[unitId] = true;
  }
  return state;
}

/**
 * Owns the Undead Legion: unlock gate, troop counts and tier latches.
 * Fully data-driven — roster behavior comes from each UnitDefinition's
 * `reveal` mode, and persistence is keyed by unit id, so new units require
 * only a definition entry.
 */
export class LegionSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private state: LegionState = freshState();

  constructor(events: EventBus, saves: SaveManager) {
    this.events = events;
    this.saves = saves;

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  get isUnlocked(): boolean {
    return this.state.unlocked;
  }

  /** Fired by the wiring layer once the Soul Siphon generator is owned. */
  checkGeneratorUnlock(ownedByGeneratorId: Record<string, number>): boolean {
    if (this.state.unlocked) return false;
    const owned = ownedByGeneratorId[LEGION_UNLOCK_REQUIREMENT.generatorId] ?? 0;
    if (owned < LEGION_UNLOCK_REQUIREMENT.requiredOwned) return false;

    this.state.unlocked = true;
    this.save();
    this.publish();
    return true;
  }

  raiseUnit(unitId: string): boolean {
    if (!this.state.unlocked) return false;
    if (this.isTierLocked(unitId) || !this.isUnitVisible(unitId)) return false;

    this.state.units[unitId] = (this.state.units[unitId] ?? 0) + 1;
    this.save();
    this.publish();
    return true;
  }

  /**
   * Generic tier latch setter. Works for ANY unit id that has a definition,
   * so future concealed/teaser tiers need no changes here.
   */
  unlockUnit(unitId: string): boolean {
    if (getUnitDef(unitId) === null) return false;
    if (this.state.unlockedUnits[unitId] === true) return false;

    this.state.unlockedUnits[unitId] = true;
    this.save();
    this.publish();
    return true;
  }

  /**
   * 'always'-reveal units are raisable from the start; everything else
   * requires its tier latch.
   */
  isTierUnlocked(unitId: string): boolean {
    const def = getUnitDef(unitId);
    if (def === null) return false;
    if (def.reveal === undefined || def.reveal === 'always') return true;
    return this.state.unlockedUnits[unitId] === true;
  }

  private isTierLocked(unitId: string): boolean {
    return !this.isTierUnlocked(unitId);
  }

  /**
   * Roster visibility: concealed units stay off the panel until revealed;
   * teaser rows show (as LOCKED); always-on units just render.
   */
  isUnitVisible(unitId: string): boolean {
    const def = getUnitDef(unitId);
    if (def === null) return false;
    if (def.reveal === 'concealed') return this.state.unlockedUnits[unitId] === true;
    return true;
  }

  private countOf(unitId: string): number {
    return this.state.units[unitId] ?? 0;
  }

  getArmySnapshot(): ArmyUnitGroup[] {
    const snapshot: ArmyUnitGroup[] = [];
    for (const def of UNIT_DEFS) {
      if (!this.isUnitVisible(def.id)) continue;
      const count = this.countOf(def.id);
      if (count > 0) {
        snapshot.push({
          unitId: def.id,
          name: def.name,
          count,
          combatPowerEach: def.combatPower,
          type: def.type,
          tags: def.tags,
        });
      }
    }
    return snapshot;
  }

  deployUnits(amount: number): ArmyUnitGroup[] | null {
    const taken = takeFromArmy(this.getArmySnapshot(), amount);
    if (taken.length === 0) return null;

    for (const group of taken) {
      const remaining = this.countOf(group.unitId) - group.count;
      if (remaining > 0) this.state.units[group.unitId] = remaining;
      else delete this.state.units[group.unitId];
    }

    this.save();
    this.publish();
    return taken;
  }

  addUnits(unitId: string, count: number): boolean {
    if (
      getUnitDef(unitId) === null ||
      this.isTierLocked(unitId) ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      return false;
    }

    this.state.units[unitId] = (this.state.units[unitId] ?? 0) + count;
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

  /**
   * Prestige support: wipes counts, tier latches and the legion unlock
   * itself. Everything here is legitimately re-earned next run.
   */
  resetRun(): void {
    this.state = freshState();
    this.save();
    this.publish();
  }

  private save(): void {
    this.saves.save(this.toBlob());
  }

  /** v2 keys plus legacy mirrors, so older builds can still read the save. */
  private toBlob(): LegionSaveBlob {
    return {
      v: SAVE_SCHEMA_VERSION,
      unlocked: this.state.unlocked,
      units: { ...this.state.units },
      unitUnlocks: { ...this.state.unlockedUnits },
      wraiths: this.countOf('wraith'),
      skeletons: this.countOf('skeleton'),
      zombies: this.countOf('zombie'),
      golems: this.countOf('flesh_golem'),
      knights: this.countOf('death_knight'),
      zombieUnlocked: this.state.unlockedUnits['zombie'] === true,
      golemUnlocked: this.state.unlockedUnits['flesh_golem'] === true,
      knightUnlocked: this.state.unlockedUnits['death_knight'] === true,
    };
  }

  private publish(): void {
    const payload: LegionChangedPayload = {
      unlocked: this.state.unlocked,
      units: { ...this.state.units },
      unlockedUnits: { ...this.state.unlockedUnits },
    };

    this.events.emit<LegionChangedPayload>(LegionEvents.Changed, payload);
  }
}

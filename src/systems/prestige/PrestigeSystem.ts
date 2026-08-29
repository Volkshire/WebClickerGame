import { AppEvents } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { checkShopRequirement, getShopItem } from './shop';
import type { ShopPurchaseResult } from './shop';
import { computePrestigeEffects } from './effects';
import type { PrestigeEffects } from './effects';
import { PrestigeEvents } from './types';
import type {
  PrestigeChangedPayload,
  PrestigePerformResult,
  PrestigeState,
} from './types';

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strict map of non-negative safe integers (shop purchases, pending rewards). */
function parseCountMap(raw: unknown): Record<string, number> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidCount(value)) return null;
    map[id] = value;
  }
  return map;
}

function parseStringList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const list: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) return null;
    list.push(entry);
  }
  return list;
}

interface ParsedSave {
  state: PrestigeState;
  /** Run-scoped rewards earned but not yet claimed by a Prestige. */
  pendingRewards: Record<string, number>;
}

/**
 * Lenient about MISSING optional fields (older saves predate points and
 * the ledgers — they default to empty), strict about malformed ones.
 */
function parseSavedState(raw: unknown): ParsedSave | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;
  if (!isValidCount(record['count'])) return null;

  const points = record['points'] === undefined ? 0 : record['points'];
  if (!isValidCount(points)) return null;

  const claimedRewards = parseStringList(record['claimedRewards']);
  if (claimedRewards === null) return null;

  const purchases = parseCountMap(record['purchases']);
  if (purchases === null) return null;

  const pendingRewards = parseCountMap(record['pendingRewards']);
  if (pendingRewards === null) return null;

  return {
    state: {
      count: record['count'],
      points,
      claimedRewards,
      purchases,
    },
    pendingRewards,
  };
}

/**
 * Owns the game's permanent progression: the Prestige counter, the
 * spendable Prestige Point balance, the reward-source ledger and the
 * Prestige Shop purchase record.
 *
 * Reward sources (Age conquests, achievements, future systems) report
 * themselves via reportReward() using stable source ids. Reported rewards
 * stay PENDING until the player performs a Prestige; performing claims
 * every pending reward into the permanent balance and moves their source
 * ids into the claimed ledger, so no source can ever pay out twice.
 * Grants no gameplay numbers itself; consumers read computePrestigeEffects().
 */
export class PrestigeSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private state: PrestigeState = { count: 0, points: 0, claimedRewards: [], purchases: {} };
  /** sourceId -> points, earned this run but not yet claimed. */
  private pendingRewards = new Map<string, number>();
  private campaignCompleted = false;
  private battleActive = false;

  constructor(events: EventBus, saves: SaveManager) {
    this.events = events;
    this.saves = saves;

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  get count(): number {
    return this.state.count;
  }

  /** Permanent spendable Prestige Point balance. */
  get points(): number {
    return this.state.points;
  }

  /** Points earned this run that the next Prestige will claim. */
  get pendingPoints(): number {
    let total = 0;
    for (const amount of this.pendingRewards.values()) total += amount;
    return total;
  }

  get effects(): PrestigeEffects {
    return computePrestigeEffects(this.state.count, this.state.purchases);
  }

  purchasedCount(itemId: string): number {
    return this.state.purchases[itemId] ?? 0;
  }

  get canPrestige(): boolean {
    return this.campaignCompleted && !this.battleActive;
  }

  /**
   * Reports an eligible reward for a source id (Age milestone, achievement,
   * ...). Idempotent: repeats of an already-reported OR already-claimed
   * source are ignored, which is what makes re-conquering an Age or
   * reloading the page safe. Pending rewards are persisted so a reload
   * can never forget them.
   */
  reportReward(sourceId: string, points: number): boolean {
    if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
    if (!Number.isSafeInteger(points) || points <= 0) return false;
    if (this.state.claimedRewards.includes(sourceId)) return false;
    if (this.pendingRewards.has(sourceId)) return true;

    this.pendingRewards.set(sourceId, points);
    this.save();
    this.publish();
    return true;
  }

  /**
   * Attempts to buy one copy of a shop item with Prestige Points.
   * Validates existence, purchase limit, requirements and affordability;
   * on success deducts the cost and records the permanent purchase.
   */
  buyShopItem(itemId: string): ShopPurchaseResult {
    const definition = getShopItem(itemId);
    if (definition === null) return { ok: false, reason: 'unknown-item' };

    const owned = this.purchasedCount(itemId);
    if (definition.maxPurchases !== null && owned >= definition.maxPurchases) {
      return { ok: false, reason: 'limit-reached' };
    }

    if (
      definition.requires !== undefined &&
      !checkShopRequirement(definition.requires, {
        prestigeCount: this.state.count,
        ownedOf: (id) => this.purchasedCount(id),
      })
    ) {
      return { ok: false, reason: 'requirement-not-met' };
    }

    if (this.state.points < definition.cost) {
      return { ok: false, reason: 'insufficient-points' };
    }

    this.state.points -= definition.cost;
    this.state.purchases[itemId] = owned + 1;
    this.save();
    this.publish();
    return { ok: true };
  }

  restore(): boolean {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) {
      this.state = parsed.state;
      this.pendingRewards = new Map(Object.entries(parsed.pendingRewards));
    }
    this.publish();
    return parsed !== null;
  }

  /** Called by the wiring layer when the world frontier reaches its end. */
  setCampaignCompleted(completed: boolean): void {
    if (this.campaignCompleted === completed) return;
    this.campaignCompleted = completed;
    this.publish();
  }

  /** Pushed by the wiring layer while any battle is resolving. */
  setBattleActive(active: boolean): void {
    if (this.battleActive === active) return;
    this.battleActive = active;
    this.publish();
  }

  /**
   * Performs the Prestige: first claims ALL pending rewards into the
   * permanent balance and records their sources as claimed, then bumps
   * the counter. The candidate state is written and read back BEFORE the
   * wiring layer resets run state, so a failing/quietly-losing storage can
   * never destroy the run without the rewards actually surviving.
   */
  perform(): PrestigePerformResult {
    if (!this.campaignCompleted) return { ok: false, reason: 'not-available' };
    if (this.battleActive) return { ok: false, reason: 'battle-active' };

    const gained = this.pendingPoints;
    const candidate: PrestigeState = {
      count: this.state.count + 1,
      points: this.state.points + gained,
      claimedRewards: [...this.state.claimedRewards, ...this.pendingRewards.keys()],
      purchases: { ...this.state.purchases },
    };
    const clearedPending: Record<string, number> = {};
    this.save(candidate, clearedPending);

    // Read back to verify persistence; retry once in case another
    // session/tab writer interleaved between save and load (race condition).
    const verified = (): boolean => {
      const readBack = parseSavedState(this.saves.load());
      if (readBack === null) return false;
      if (
        readBack.state.count !== candidate.count ||
        readBack.state.points !== candidate.points
      ) {
        return false;
      }
      return candidate.claimedRewards.every((sourceId) =>
        readBack.state.claimedRewards.includes(sourceId),
      );
    };
    if (!verified()) {
      this.save(candidate, clearedPending); // re-try the save
      if (!verified()) return { ok: false, reason: 'storage' };
    }

    this.state = candidate;
    this.pendingRewards.clear();
    this.publish();
    return { ok: true, pointsGained: gained };
  }

  /** Persists the given state (defaults to current state + pending). */
  private save(stateOverride?: PrestigeState, pendingOverride?: Record<string, number>): void {
    const state = stateOverride ?? this.state;
    const pending = pendingOverride ?? Object.fromEntries(this.pendingRewards);
    this.saves.save({
      v: SAVE_SCHEMA_VERSION,
      count: state.count,
      points: state.points,
      claimedRewards: [...state.claimedRewards],
      purchases: { ...state.purchases },
      pendingRewards: { ...pending },
    });
  }

  private publish(): void {
    const effects = computePrestigeEffects(this.state.count, this.state.purchases);
    const payload: PrestigeChangedPayload = {
      count: this.state.count,
      damageBonusPercent: Math.round((effects.attackerDamageMultiplier - 1) * 100),
      campaignCompleted: this.campaignCompleted,
      battleActive: this.battleActive,
      points: this.state.points,
      pendingPoints: this.pendingPoints,
      purchases: { ...this.state.purchases },
    };
    this.events.emit<PrestigeChangedPayload>(PrestigeEvents.Changed, payload);
  }
}

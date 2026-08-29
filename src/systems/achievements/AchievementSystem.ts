import { AppEvents } from '../../core/Application';
import type { EventBus } from '../../core/EventBus';
import { isSupportedSchemaVersion, SAVE_SCHEMA_VERSION } from '../../core/SaveManager';
import type { SaveManager } from '../../core/SaveManager';
import { ACHIEVEMENTS } from './achievements';
import { getConditionMetric } from './conditionEvaluators';
import { AchievementEvents, formatAchievementReward } from './types';
import type {
  AchievementCompletedPayload,
  AchievementDefinition,
  AchievementState,
  AchievementViewData,
  AchievementsChangedPayload,
  GameStatsSnapshot,
} from './types';

function isValidCompletionIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Strict: one malformed entry rejects the whole blob (falls back to defaults). */
function parseSavedState(raw: unknown): AchievementState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record)) return null;

  const completedRaw = record['completed'];
  if (completedRaw === undefined || completedRaw === null) return { completed: {} };
  if (typeof completedRaw !== 'object' || Array.isArray(completedRaw)) return null;

  const completed: Record<string, number> = {};
  for (const [id, index] of Object.entries(completedRaw)) {
    if (typeof id !== 'string' || id.length === 0 || !isValidCompletionIndex(index)) return null;
    completed[id] = index;
  }
  return { completed };
}

function conditionGoalOf(definition: AchievementDefinition): number {
  const amount = definition.condition.amount;
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0
    ? amount
    : 1;
}

const ZERO_SNAPSHOT: GameStatsSnapshot = {
  lifetimeClicks: 0,
  souls: 0,
  targetsCleared: 0,
  legionSize: 0,
  conqueredAges: 0,
  prestigeCount: 0,
};

/**
 * Owns permanent achievement tracking. Completion is a latch: once an
 * achievement completes it is persisted forever and can NEVER complete or
 * reward again, no matter how often conditions re-apply.
 *
 * The system is intentionally reward-agnostic — it publishes what a
 * definition promised; the wiring layer routes 'prestige-points' rewards
 * to the prestige system's pending pool.
 */
export class AchievementSystem {
  private readonly events: EventBus;
  private readonly saves: SaveManager;
  private state: AchievementState = { completed: {} };
  /** Latest snapshot seen, for progress display between evaluations. */
  private lastStats: GameStatsSnapshot = ZERO_SNAPSHOT;
  private warnedUnknownKinds = new Set<string>();
  /** Serialized render state of the last publish; drives change detection. */
  private lastSignature: string | null = null;

  constructor(events: EventBus, saves: SaveManager) {
    this.events = events;
    this.saves = saves;

    // Page hidden (tab switch, minimize, mobile app background): persist now.
    events.on(AppEvents.Flush, () => {
      this.save();
    });
  }

  restore(): boolean {
    const parsed = parseSavedState(this.saves.load());
    if (parsed !== null) this.state = parsed;
    this.lastSignature = this.viewSignature();
    this.publish();
    return parsed !== null;
  }

  /**
   * Checks every incomplete achievement against the snapshot. Cheap enough
   * to call on every game-state change. Publishes when completions occur
   * OR when visible progress moved, so an open panel stays live without
   * spamming identical payloads.
   */
  evaluate(stats: GameStatsSnapshot): void {
    this.lastStats = stats;

    let newlyCompleted = 0;
    for (const definition of ACHIEVEMENTS) {
      if (this.state.completed[definition.id] !== undefined) continue;

      const metric = getConditionMetric(definition.condition.kind);
      if (metric === null) {
        this.warnUnknownKindOnce(definition.condition.kind);
        continue;
      }
      if (metric(stats) >= conditionGoalOf(definition)) {
        this.complete(definition);
        newlyCompleted += 1;
      }
    }

    const signature = this.viewSignature();
    if (newlyCompleted > 0 || signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.publish();
    }
  }

  /** Completed achievements that promise Prestige Points, for boot catch-up. */
  getCompletedPrestigePointRewards(): { id: string; amount: number }[] {
    return ACHIEVEMENTS.filter(
      (definition) =>
        definition.reward.type === 'prestige-points' &&
        this.state.completed[definition.id] !== undefined,
    ).map((definition) => ({
      id: definition.id,
      amount: definition.reward.type === 'prestige-points' ? definition.reward.amount : 0,
    }));
  }

  private complete(definition: AchievementDefinition): void {
    // Order counter doubles as a stable completion sequence for future UI.
    this.state.completed[definition.id] = Object.keys(this.state.completed).length + 1;
    this.save();
    const payload: AchievementCompletedPayload = {
      id: definition.id,
      name: definition.name,
      reward: definition.reward,
    };
    this.events.emit<AchievementCompletedPayload>(AchievementEvents.Completed, payload);
  }

  private warnUnknownKindOnce(kind: string): void {
    if (this.warnedUnknownKinds.has(kind)) return;
    this.warnedUnknownKinds.add(kind);
    console.warn(`AchievementSystem: no evaluator registered for condition kind "${kind}".`);
  }

  private buildViews(): AchievementViewData[] {
    return ACHIEVEMENTS.map((definition) => {
      const completed = this.state.completed[definition.id] !== undefined;
      const metric = getConditionMetric(definition.condition.kind);
      const goal = conditionGoalOf(definition);
      // Completed rows freeze at their goal so regressing live stats
      // (e.g. Souls spent) never changes the rendered state.
      const progress =
        metric === null
          ? null
          : { current: completed ? goal : Math.min(metric(this.lastStats), goal), goal };

      // Spoiler gate: an undiscovered spoiler achievement ships FULLY
      // redacted so its text cannot reveal locked content. Display-only —
      // evaluation, completion and rewards above are untouched, and the
      // row unmasks permanently the moment it completes.
      if (definition.spoiler === true && !completed) {
        return {
          id: definition.id,
          name: '???',
          description: 'Hidden achievement',
          completed: false,
          progress: null,
          rewardText: '',
          masked: true,
        };
      }

      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        completed,
        progress,
        rewardText: formatAchievementReward(definition.reward),
        masked: false,
      };
    });
  }

  /** Compact render-state fingerprint used to skip redundant publishes. */
  private viewSignature(): string {
    return this.buildViews()
      .map((view) => `${view.id}:${view.completed ? 1 : 0}:${view.progress?.current ?? '-'}`)
      .join('|');
  }

  private save(): void {
    this.saves.save({
      v: SAVE_SCHEMA_VERSION,
      completed: { ...this.state.completed },
    });
  }

  private publish(): void {
    const achievements = this.buildViews();
    const payload: AchievementsChangedPayload = {
      achievements,
      completedCount: achievements.filter((entry) => entry.completed).length,
    };
    this.events.emit<AchievementsChangedPayload>(AchievementEvents.Changed, payload);
  }
}

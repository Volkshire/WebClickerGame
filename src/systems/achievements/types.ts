/**
 * Achievement system contracts.
 *
 * Conditions are OPEN data: `kind` is looked up in the evaluator registry
 * (conditionEvaluators.ts) and unknown kinds simply never complete, so new
 * achievement definitions may reference stats sources that do not exist
 * yet without breaking the system. Rewards are equally open data — the
 * achievement system never grants them itself; the wiring layer routes a
 * completed definition's declared reward (one option being Prestige
 * Points) to whichever system implements it.
 */

export interface AchievementCondition {
  /** Registry key ('lifetime-clicks', 'conquered-ages', ...). */
  kind: string;
  /** Metric goal; defaults to 1 when omitted. */
  amount?: number;
  /** Reserved for future targeted conditions (specific Age, commander...). */
  targetId?: string;
}

export type AchievementReward =
  | { type: 'none' }
  | { type: 'prestige-points'; amount: number };

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  condition: AchievementCondition;
  reward: AchievementReward;
  /**
   * Spoiler protection: while incomplete, the achievement is presented as
   * a redacted "???" row so its text cannot reveal locked content.
   */
  spoiler?: boolean;
}

/**
 * Authoritative numbers the evaluator may inspect. Extended as game
 * systems grow; existing achievements keep working unchanged.
 */
export interface GameStatsSnapshot {
  /** Harvest clicks across all runs (lifetime stat). */
  lifetimeClicks: number;
  souls: number;
  /** Campaign targets cleared during the CURRENT run, all Ages combined. */
  targetsCleared: number;
  /** Undead currently in the garrison. */
  legionSize: number;
  /** Ages fully conquered during the CURRENT run. */
  conqueredAges: number;
  /** Total Prestiges ever performed. */
  prestigeCount: number;
}

export interface AchievementProgress {
  current: number;
  goal: number;
}

export interface AchievementViewData {
  id: string;
  name: string;
  description: string;
  completed: boolean;
  /** null when the condition has no numeric metric (unknown kind) or the row is masked. */
  progress: AchievementProgress | null;
  rewardText: string;
  /** True while a spoiler achievement is still undiscovered (fields redacted). */
  masked: boolean;
}

export interface AchievementsChangedPayload {
  achievements: AchievementViewData[];
  completedCount: number;
}

/** Emitted EXACTLY once per achievement, ever (completion is permanent). */
export interface AchievementCompletedPayload {
  id: string;
  name: string;
  reward: AchievementReward;
}

export const AchievementEvents = {
  Changed: 'achievements:changed',
  Completed: 'achievements:completed',
} as const;

/** Permanent cross-run state; survives Prestige resets by design. */
export interface AchievementState {
  /** achievementId -> completion order counter (1-based). */
  completed: Record<string, number>;
}

export function formatAchievementReward(reward: AchievementReward): string {
  if (reward.type === 'prestige-points') {
    const amount = Number.isSafeInteger(reward.amount) ? reward.amount : 0;
    return `+${amount} Prestige Point${amount === 1 ? '' : 's'}`;
  }
  return 'No reward';
}

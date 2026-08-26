/** Permanent cross-run state: Prestige count, spendable points and ledgers. */
export interface PrestigeState {
  count: number;
  /** Spendable Prestige Points: claimed rewards minus spent shop costs. */
  points: number;
  /**
   * Reward sources whose payout has already been granted, permanently.
   * A source id can never pay out twice (e.g. re-conquering an Age in a
   * later run must not farm another point).
   */
  claimedRewards: string[];
  /** Purchased shop items -> purchase count (permanent items cap at their limit). */
  purchases: Record<string, number>;
}

export type PrestigePerformFailureReason = 'not-available' | 'battle-active' | 'storage';

export interface PrestigePerformResult {
  ok: boolean;
  reason?: PrestigePerformFailureReason;
  /** Points converted from pending rewards into the permanent balance. */
  pointsGained?: number;
}

export interface PrestigeChangedPayload {
  count: number;
  /** Current permanent combat damage bonus in whole percent (10 per Prestige). */
  damageBonusPercent: number;
  /** True once the campaign frontier is fully cleared; gates the action. */
  campaignCompleted: boolean;
  /** True while a battle is resolving; blocks the Prestige action. */
  battleActive: boolean;
  /** Permanent spendable Prestige Point balance. */
  points: number;
  /** Points earned this run but not yet claimed by performing a Prestige. */
  pendingPoints: number;
  /** Purchased shop items -> purchase count (drives shop UI states). */
  purchases: Record<string, number>;
}

export const PrestigeEvents = {
  Changed: 'prestige:changed',
} as const;

/**
 * Condition evaluator registry: maps condition kinds to the snapshot
 * metric they measure. Adding a new kind of achievement (combat wins,
 * enemies defeated, commanders defeated, future systems...) means adding
 * one entry here plus a field on GameStatsSnapshot — the achievement
 * engine and UI stay untouched.
 */

import type { GameStatsSnapshot } from './types';

export type ConditionMetric = (stats: GameStatsSnapshot) => number;

export const CONDITION_EVALUATORS: Readonly<Record<string, ConditionMetric>> = {
  'lifetime-clicks': (stats) => stats.lifetimeClicks,
  'souls-current': (stats) => stats.souls,
  'targets-cleared': (stats) => stats.targetsCleared,
  'legion-size': (stats) => stats.legionSize,
  'conquered-ages': (stats) => stats.conqueredAges,
  'prestige-count': (stats) => stats.prestigeCount,
};

/** Returns null for unknown kinds — those achievements never complete. */
export function getConditionMetric(kind: string): ConditionMetric | null {
  if (!Object.prototype.hasOwnProperty.call(CONDITION_EVALUATORS, kind)) return null;
  return CONDITION_EVALUATORS[kind];
}

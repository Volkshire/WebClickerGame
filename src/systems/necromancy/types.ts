import type { BuildingCostEntry } from '../buildings/types';
import type { BuildingStocks } from '../buildings/types';

export type { BuildingCostEntry, BuildingStocks };

export interface NecromancyState {
  /** Research levels keyed by upgrade id; absent ids are level 0. */
  levels: Record<string, number>;
}

/** One research card for the panel. */
export interface NecromancyUpgradeRow {
  id: string;
  name: string;
  description: string;
  flavor: string;
  effectText: string;
  level: number;
  maxLevel: number;
  nextCosts: readonly BuildingCostEntry[];
}

export interface NecromancyChangedPayload {
  upgrades: readonly NecromancyUpgradeRow[];
}

export const NecromancyEvents = {
  Changed: 'necromancy:changed',
} as const;

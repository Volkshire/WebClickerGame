import type { BuildingCosts, BuildingCurrency } from './buildings';

export type { BuildingCosts, BuildingCurrency };

export interface BuildingsState {
  /** Owned levels keyed by building id; absent ids are level 0. */
  levels: Record<string, number>;
}

/** One priced currency line for the next purchase; empty when maxed out. */
export interface BuildingCostEntry {
  currency: BuildingCurrency;
  amount: number;
}

export interface BuildingViewRow {
  id: string;
  name: string;
  /** Static what-it-does line, visible before purchase. */
  description: string;
  flavor: string;
  effectText: string;
  level: number;
  maxLevel: number;
  nextCosts: readonly BuildingCostEntry[];
}

export interface BuildingsChangedPayload {
  buildings: readonly BuildingViewRow[];
}

export const BuildingEvents = {
  Changed: 'buildings:changed',
} as const;

/** Balances the view needs to color cost affordability per row. */
export interface BuildingStocks {
  souls: number;
  bone: number;
  flesh: number;
  iron: number;
}

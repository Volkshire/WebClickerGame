import type { ResourceId } from '../resources/types';
import type { UnitDefinition } from './units';

/** Everything a unit can cost, keyed by what the caller currently owns. */
export interface ResourceStocks {
  souls: number;
  bone: number;
  flesh: number;
  iron: number;
}

function stockOf(stocks: ResourceStocks, resourceId: string): number {
  switch (resourceId as ResourceId) {
    case 'bone':
      return stocks.bone;
    case 'flesh':
      return stocks.flesh;
    case 'iron':
      return stocks.iron;
    default:
      return 0;
  }
}

/**
 * Per-unit cost under a cost multiplier (e.g. the Prestige Shop's
 * recruitment discount). Ceils so costs stay payable in whole resources;
 * affordability checks and actual debits MUST share this helper or the
 * roster preview would disagree with what purchases really charge.
 */
export function scaledUnitCost(perUnitCost: number, multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return perUnitCost;
  return Math.ceil(perUnitCost * multiplier);
}

/**
 * How many of this unit can be paid for in full right now, capped at
 * `cap`. Pure arithmetic (no per-unit looping) so huge stocks stay cheap.
 */
export function payableCount(
  def: UnitDefinition,
  stocks: ResourceStocks,
  costMultiplier: number = 1,
  cap: number = Number.POSITIVE_INFINITY,
): number {
  let limit = Math.floor(stocks.souls / scaledUnitCost(def.soulCost, costMultiplier));
  for (const [resourceId, amount] of Object.entries(def.resourceCosts)) {
    const cost = amount ?? 0;
    if (cost <= 0) continue;
    limit = Math.min(limit, Math.floor(stockOf(stocks, resourceId) / scaledUnitCost(cost, costMultiplier)));
  }
  return Math.max(0, Math.min(limit, cap));
}

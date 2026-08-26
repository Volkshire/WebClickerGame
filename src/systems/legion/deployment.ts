import type { ArmyUnitGroup } from './types';

/**
 * Takes up to `amount` individual troops from the army, cheapest-first.
 * Pure shared math: used by LegionSystem.deployUnits and by UI previews so
 * both always agree on composition and power.
 */
export function takeFromArmy(army: ArmyUnitGroup[], amount: number): ArmyUnitGroup[] {
  if (!Number.isSafeInteger(amount) || amount < 1 || army.length === 0) return [];

  const taken: ArmyUnitGroup[] = [];
  let remaining = amount;
  for (const group of army) {
    if (remaining <= 0) break;
    const count = Math.min(remaining, group.count);
    remaining -= count;
    taken.push({ ...group, count });
  }
  return taken;
}

export function armyPower(groups: ArmyUnitGroup[]): number {
  let power = 0;
  for (const group of groups) power += group.count * group.combatPowerEach;
  return power;
}

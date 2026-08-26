import { exponentialCostAt } from '../buildings/buildings';
import type { BuildingCosts } from '../buildings/buildings';

/**
 * Necromancy research catalog — pure data, mirroring the Crypt buildings
 * shape. New upgrades are one entry here plus (when they need one) a
 * consumer for their effect in the wiring layer.
 */

export interface NecromancyUpgradeDefinition {
  id: string;
  name: string;
  /** Static what-it-does line, shown even before purchase. */
  description: string;
  flavor: string;
  maxLevel: number;
  baseCosts: BuildingCosts;
  growthRate: number;
  effectText: (level: number) => string;
}

export const KNIGHT_SQUIRE_UPGRADE_ID = 'knight-squire';
export const ZOMBIE_PLAGUE_UPGRADE_ID = 'zombie-plague';

/** Campaign targets that must be cleared before the dead start teaching. */
export const NECROMANCY_UNLOCK_CLEARS = 4;

export const NECROMANCY_UPGRADES: readonly NecromancyUpgradeDefinition[] = [
  {
    id: KNIGHT_SQUIRE_UPGRADE_ID,
    name: 'A Knight and his Squire',
    description: 'Each Death Knight raised also raises free Skeletons.',
    flavor: 'Every lord needs someone to carry the shields. And the bodies.',
    maxLevel: 5,
    baseCosts: { souls: 2000, bone: 1500, iron: 1000 },
    growthRate: 2,
    effectText: (level) =>
      level > 0
        ? `Death Knight raises bring +${level} Skeleton${level === 1 ? '' : 's'} each`
        : '',
  },
  {
    id: ZOMBIE_PLAGUE_UPGRADE_ID,
    name: 'Zombie Plague',
    description:
      'Zombie kills raise the slain mid-battle, up to a quarter of the enemy garrison.',
    flavor: 'Death is no longer the end. For them, neither is undeath.',
    maxLevel: 1,
    baseCosts: { flesh: 5000 },
    growthRate: 1,
    effectText: (level) =>
      level > 0 ? 'Zombie kills spawn fresh Zombies during battle' : '',
  },
];

/** Same exponential curve as Crypt buildings; shared helper guarantees parity. */
export function necromancyCostAt(
  definition: NecromancyUpgradeDefinition,
  level: number,
): BuildingCosts {
  return exponentialCostAt(definition.baseCosts, definition.growthRate, level);
}

/**
 * Free Skeletons granted alongside a Death Knight raise at the given
 * upgrade level. Bulk-safe: raising N Death Knights at once brings N
 * squires per level.
 */
export function squiresFor(level: number, deathKnightCount: number): number {
  if (!Number.isSafeInteger(level) || level <= 0) return 0;
  if (!Number.isSafeInteger(deathKnightCount) || deathKnightCount <= 0) return 0;
  return level * deathKnightCount;
}

import type { ResourceId } from '../resources/types';

/** Currencies a building can be priced in; extensible without schema churn. */
export type BuildingCurrency = 'souls' | ResourceId;

export type BuildingCosts = Partial<Record<BuildingCurrency, number>>;

/** Data-driven unlock requirement: the building is hidden until another building reaches minLevel. */
export interface BuildingUnlockRequirement {
  /** The building ID that must meet the requirement. */
  buildingId: string;
  /** The minimum level required on that building. */
  minLevel: number;
}

export interface BuildingDefinition {
  id: string;
  name: string;
  /** Static what-it-does line, shown even before the first purchase. */
  description: string;
  /** One-line flavor text shown on the building card. */
  flavor: string;
  /** 1 = one-shot building; >1 = leveled building. */
  maxLevel: number;
  /** Cost of the FIRST level; leveled buildings grow by growthRate per level. */
  baseCosts: BuildingCosts;
  /** Per-level cost multiplier; ignored for one-shot buildings. */
  growthRate: number;
  /** Human-readable current effect for the owned level ('' before first buy). */
  effectText: (level: number) => string;
  /** Optional: building is hidden until another building reaches minLevel. */
  unlockRequirement?: BuildingUnlockRequirement;
}

export const AUTO_RAISE_INTERVAL_SECONDS = 5;

/**
 * The game's shared exponential cost curve (base × rate^level, rounded per
 * currency). Used by Crypt buildings AND Necromancy research so every
 * scalable purchase prices identically.
 */
export function exponentialCostAt(
  baseCosts: BuildingCosts,
  growthRate: number,
  level: number,
): BuildingCosts {
  const costs: BuildingCosts = {};
  for (const [currency, base] of Object.entries(baseCosts)) {
    const amount = Math.round((base ?? 0) * growthRate ** level);
    if (amount > 0) costs[currency as BuildingCurrency] = amount;
  }
  return costs;
}

export const BUILDINGS: readonly BuildingDefinition[] = [
  {
    id: 'auto-raise',
    name: 'Auto-Raise',
    description: 'Automatically raises Wraiths every 5 seconds.',
    flavor: 'The graveyard staffs itself these days.',
    maxLevel: 20,
    baseCosts: { souls: 500 },
    growthRate: 1.25,
    effectText: (level) =>
      level > 0 ? `Raises up to ${level} Wraith${level === 1 ? '' : 's'} every ${AUTO_RAISE_INTERVAL_SECONDS}s` : '',
  },
  {
    id: 'soul-net',
    name: 'Soul Net',
    description: '+1 Soul for every enemy slain in battle.',
    flavor: 'Every corpse owes the house a soul.',
    maxLevel: 1,
    baseCosts: { iron: 1000 },
    growthRate: 1,
    effectText: (level) => (level > 0 ? '+1 Soul per enemy killed in battle' : ''),
  },
  {
    id: 'ossuary',
    name: 'Ossuary',
    description: '+1 Bone per second per level.',
    flavor: "The dead won't mind missing a bone. They have plenty to spare.",
    maxLevel: 3,
    baseCosts: { iron: 3000 },
    growthRate: 2,
    effectText: (level) => (level > 0 ? `+${level} Bone per second` : ''),
  },
  {
    id: 'bone-sorting-house',
    name: 'Bone Sorting House',
    description: '+1 Bone per Bone looted after battles.',
    flavor: 'Every bone counted, catalogued, and put back to work.',
    maxLevel: 1,
    baseCosts: { iron: 5000 },
    growthRate: 1,
    effectText: (level) => (level > 0 ? 'Bone loot doubled after battles' : ''),
  },
  {
    id: 'fleshworks',
    name: 'Fleshworks',
    description: '+1 Flesh per second per level.',
    flavor: 'The flesh weaves itself, given time and enough corpses.',
    maxLevel: 5,
    baseCosts: { souls: 2000, bone: 500 },
    growthRate: 1.5,
    effectText: (level) => (level > 0 ? `+${level} Flesh per second` : ''),
  },
  {
    id: 'ossuary-auto-raiser',
    name: 'Ossuary Auto-Raiser',
    description: 'Automatically raises Skeletons every 5 seconds.',
    flavor: 'The bones rise of their own accord when the Ossuary is full.',
    maxLevel: 10,
    baseCosts: { souls: 3000, bone: 1000, iron: 500 },
    growthRate: 1.3,
    effectText: (level) =>
      level > 0 ? `Raises up to ${level} Skeleton${level === 1 ? '' : 's'} every 5s` : '',
    unlockRequirement: { buildingId: 'ossuary', minLevel: 3 },
  },
];

/**
 * Cost of reaching `level + 1`, rounded per currency. For one-shot buildings
 * `level` is always 0 when purchasing.
 */
export function buildingCostAt(definition: BuildingDefinition, level: number): BuildingCosts {
  return exponentialCostAt(definition.baseCosts, definition.growthRate, level);
}

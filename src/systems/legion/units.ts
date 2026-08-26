import type { ResourceId } from '../resources/types';
import type { UnitTag, UnitType } from '../combat/unitTypes';

export const SOUL_SIPHON_GENERATOR_ID = 'soul-siphon';

export const LEGION_UNLOCK_REQUIREMENT = {
  generatorId: SOUL_SIPHON_GENERATOR_ID,
  requiredOwned: 1,
} as const;

export interface UnitDefinition {
  id: string;
  name: string;
  combatPower: number;
  soulCost: number;
  /** Non-Soul raise cost per resource id; entries with amount <= 0 are ignored. */
  resourceCosts: Partial<Record<ResourceId, number>>;
  type: UnitType;
  tags: readonly UnitTag[];
  /**
   * How the unit appears in the roster before its latch fires:
   *  - 'always' (default): normal row, immediately raisable.
   *  - 'teaser': visible row with a LOCKED chip until unlocked.
   *  - 'concealed': fully hidden until unlocked (surprise reveal).
   */
  reveal?: 'concealed' | 'teaser' | 'always';
  /**
   * Campaign targets that must be cleared before this tier unlocks
   * (mediated by main.ts watching CombatEvents.Changed).
   */
  unlockAfterClears?: number;
}

export const WRAITH_UNIT: UnitDefinition = {
  id: 'wraith',
  name: 'Wraith',
  combatPower: 1,
  soulCost: 1,
  resourceCosts: {},
  type: 'melee',
  tags: ['spirit'],
};

/** Always visible once the legion is unlocked; raisable with Souls + Bone. */
export const SKELETON_UNIT: UnitDefinition = {
  id: 'skeleton',
  name: 'Skeleton',
  combatPower: 2,
  soulCost: 1,
  resourceCosts: { bone: 1 },
  type: 'melee',
  tags: ['bone'],
};

/** Fully hidden until the first Flesh is received. */
export const ZOMBIE_UNIT: UnitDefinition = {
  id: 'zombie',
  name: 'Zombie',
  combatPower: 6,
  soulCost: 3,
  resourceCosts: { flesh: 10 },
  type: 'melee',
  tags: ['flesh'],
  reveal: 'concealed',
};

/** Hidden until Grand Town is cleared (campaign 4/10). */
export const FLESH_GOLEM_UNIT: UnitDefinition = {
  id: 'flesh_golem',
  name: 'Flesh Golem',
  combatPower: 25,
  soulCost: 10,
  resourceCosts: { bone: 10, flesh: 10 },
  type: 'melee',
  tags: ['flesh', 'armored'],
  reveal: 'concealed',
  unlockAfterClears: 4,
};

/** Hidden until Temple City is cleared (campaign 5/10). */
export const DEATH_KNIGHT_UNIT: UnitDefinition = {
  id: 'death_knight',
  name: 'Death Knight',
  combatPower: 75,
  soulCost: 25,
  resourceCosts: { bone: 25, flesh: 25, iron: 10 },
  type: 'melee',
  tags: ['bone', 'armored'],
  reveal: 'concealed',
  unlockAfterClears: 5,
};

export const UNIT_DEFS: UnitDefinition[] = [
  WRAITH_UNIT,
  SKELETON_UNIT,
  ZOMBIE_UNIT,
  FLESH_GOLEM_UNIT,
  DEATH_KNIGHT_UNIT,
];

export function getUnitDef(unitId: string): UnitDefinition | null {
  return UNIT_DEFS.find((def) => def.id === unitId) ?? null;
}

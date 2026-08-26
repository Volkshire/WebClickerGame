/**
 * Age-agnostic unit taxonomy shared by player and enemy armies.
 * Everything here is data-driven: new types, tiers and tags are added as
 * entries — never as new code paths.
 */

export const UNIT_TYPES = {
  melee: 'melee',
  ranged: 'ranged',
} as const;

export type UnitType = (typeof UNIT_TYPES)[keyof typeof UNIT_TYPES];

/** Ordered low → high; the array index IS the rank. */
export const UNIT_TIER_ORDER = [
  'recruit',
  'trained',
  'veteran',
  'elite',
  'commander',
  'hero',
] as const;

export type UnitTier = (typeof UNIT_TIER_ORDER)[number];

export function tierRank(tier: UnitTier): number {
  return UNIT_TIER_ORDER.indexOf(tier);
}

export const UNIT_TAGS = ['spirit', 'bone', 'flesh', 'armored'] as const;

export type UnitTag = (typeof UNIT_TAGS)[number];

/**
 * Hero Class System — hidden class assignment for enemy Heroes.
 *
 * Each Hero is assigned exactly ONE class at creation time. The class
 * determines which skills the Hero is eligible to use. Classes are NOT
 * shown to the player; they are an internal routing mechanism.
 *
 * When spawning multiple Heroes for the same target, new Heroes avoid
 * duplicating classes already present (so a fresh pair is always
 * heterogeneous). Fled veterans returning via grudge may duplicate classes
 * since they are returning individuals, not new spawns.
 */

export const HERO_CLASSES = ['caster', 'ranged', 'support', 'tank'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

/** Skill loadout per Hero class — the single source of truth. */
export const HERO_CLASS_LOADOUTS: Readonly<Record<HeroClass, readonly string[]>> = {
  caster: [
    'spirit-devastator',
    'meteor-storm',
    'chain-lightning',
    'fireball',
  ],
  ranged: [
    'rapid-fire',
    'projectile-rain',
  ],
  support: [
    'shield-of-protection',
    'phoenix-down',
  ],
  tank: [
    'whirlwind-slash',
    'shield-bash',
  ],
};

/**
 * Picks a class from the pool, avoiding classes already in `existing`.
 * When all classes are exhausted, falls back to uniform random.
 * Used during fresh Hero spawning (not for returning grudge Heroes).
 */
export function pickHeroClass(
  existing: readonly HeroClass[],
  rng: () => number,
): HeroClass {
  const available = HERO_CLASSES.filter((c) => !existing.includes(c));
  const pool = available.length > 0 ? available : HERO_CLASSES;
  return pool[Math.floor(rng() * pool.length)]!;
}

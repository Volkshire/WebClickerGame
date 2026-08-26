/**
 * Shared combat math. Kept free of state so both the live simulation and
 * any future resolver replacement use identical formulas.
 */
import {
  HERO_COMBAT_TUNING,
  HERO_TIER_DAMAGE_MULTIPLIER,
  HERO_VICTIM_TIER_BY_CP,
} from './pacing';
import type { UnitTier } from './unitTypes';

export function effectivePower(basePower: number, modifier: number): number {
  return basePower * modifier;
}

/**
 * Fraction of a side lost this tick:
 *   base rate x (enemy effective power / own effective power), clamped.
 */
export function casualtyFraction(
  baseRatePerTick: number,
  ownEffectivePower: number,
  enemyEffectivePower: number,
  maxFraction: number,
): number {
  if (ownEffectivePower <= 0) return 1;
  const fraction = (baseRatePerTick * enemyEffectivePower) / ownEffectivePower;
  return Math.min(maxFraction, Math.max(0, fraction));
}

/**
 * Fraction of incoming damage a Hero actually takes, given how many Heroes
 * are alive on their side. Base reduction plus a diminishing (sqrt) pack
 * bonus per extra living Hero, hard-capped so Heroes stay mortal.
 */
export function heroDamageTakenFraction(livingHeroes: number): number {
  const tuning = HERO_COMBAT_TUNING;
  const count = Math.min(Math.max(1, Math.floor(livingHeroes)), tuning.allyBonusCapCount);
  const packBonus = tuning.allyBonusPerSqrtStep * Math.sqrt(count - 1);
  return 1 - Math.min(tuning.loneDamageReduction + packBonus, tuning.maxTotalReduction);
}

/** One opposing stack, reduced to what the Hero swarm-mass curve needs. */
export interface HeroSwarmStack {
  readonly surviving: number;
  readonly combatPowerEach: number;
}

/**
 * Threat mass of the army facing a Hero. Headcount enters with an exponent
 * below 1 (diminishing returns: hordes of weak units add far less than
 * their raw size suggests) and individual unit quality compounds with its
 * own exponent (a few strong units outweigh their share of bodies).
 */
export function heroSwarmMass(stacks: readonly HeroSwarmStack[]): number {
  const tuning = HERO_COMBAT_TUNING;
  let mass = 0;
  for (const stack of stacks) {
    if (!(stack.surviving > 0)) continue;
    mass +=
      Math.pow(stack.surviving, tuning.swarmMassExponent) *
      Math.pow(Math.max(stack.combatPowerEach, 1), tuning.unitCpExponent);
  }
  return mass;
}

/**
 * Fraction of resolve a Hero loses per tick against a swarm of the given
 * mass: saturating so even enormous armies approach — never exceed — the
 * base rate, while small forces barely register.
 */
export function heroIncomingFraction(swarmMass: number): number {
  const tuning = HERO_COMBAT_TUNING;
  return (tuning.incomingBaseRate * swarmMass) / (swarmMass + tuning.swarmMassHalf);
}

/** Victim-stack tier band for Hero anti-chaff damage; fallback is no-bonus. */
function heroVictimTier(combatPowerEach: number): UnitTier {
  for (const band of HERO_VICTIM_TIER_BY_CP) {
    if (combatPowerEach <= band.maxCp) return band.tier;
  }
  return 'commander';
}

/**
 * Casualty multiplier applied to a Hero's kills against one victim stack
 * (tier-inferred from its combat power). Undefined/unknown shapes and
 * commander-band stacks return exactly 1 — normal-unit behavior.
 */
export function heroVictimDamageMultiplier(combatPowerEach: number): number {
  return HERO_TIER_DAMAGE_MULTIPLIER[heroVictimTier(combatPowerEach)];
}

import type { UnitTier } from './unitTypes';

/**
 * Battle pacing configuration. Tune these to speed battles up or down;
 * no code changes required.
 */
export interface BattlePacing {
  /** How often combat is processed while a battle runs. */
  tickIntervalMs: number;
  /** Base fraction of a side lost per tick, scaled by the power ratio. */
  baseCasualtyRatePerTick: number;
  /** Upper clamp for any single tick's casualty fraction. */
  maxCasualtyRatePerTick: number;
  /**
   * Last Stand: while ONLY Heroes remain on the defense, their combined
   * Heroic Threat is multiplied by this factor.
   */
  lastStandThreatMultiplier: number;
  /**
   * Last Stand: chance (0-1), rolled ONCE at the moment only Heroes remain,
   * that one additional Hero reinforces them mid-battle.
   */
  lastStandReinforceChance: number;
  /**
   * Hard per-tick ceiling on a Hero's resolve damage, regardless of how
   * badly outgunned they are. Prevents burst vaporization.
   */
  maxHeroResolveLossPerTick: number;
}

/** Base resolve for a fresh hero; grows with campaign order via the factory. */
export const HERO_RESOLVE_BASE = 5;

export const DEFAULT_BATTLE_PACING: BattlePacing = {
  tickIntervalMs: 700,
  baseCasualtyRatePerTick: 0.18,
  // Clamps the worst-case wipe rate so even hopeless fights last ~9 ticks
  // (~6s): the bars and battle log stay observable instead of flashing by.
  maxCasualtyRatePerTick: 0.11,
  lastStandThreatMultiplier: 1.75,
  lastStandReinforceChance: 0.1,
  maxHeroResolveLossPerTick: 1,
};

export const RETREAT_THRESHOLD = 0.35;
/** Defender survivors as fraction of deployed must be at or below this to be eligible to flee. */
export const RETREAT_CHANCE_PER_TICK = 0.12;
/** Extra chance when attacker has momentum (adds to RETREAT_CHANCE_PER_TICK). */
export const RETREAT_MOMENTUM_BONUS = 0.06;
/** Extra retreat chance for Ranged-class heroes (backline skirmishers flee faster). */
export const RETREAT_RANGED_BONUS = 0.08;

/** Zombie Plague: max share of the enemy garrison convertible per battle. */
export const ZOMBIE_PLAGUE_ENEMY_SHARE_CAP = 0.25;

/**
 * Support Passive: base chance per living Support hero per tick to revive
 * one fallen ally. Diminishes with each extra Support hero.
 */
export const SUPPORT_REVIVAL_BASE_CHANCE = 0.12;

/** Hard cap on Support Passive revivals per tick (all Support heroes combined). */
export const SUPPORT_REVIVAL_MAX_PER_TICK = 1;

/**
 * Zombie Plague: fire a replenishment flavor beat every Nth spawn tick after
 * the initial rising (keeps the log lively without flooding it).
 */
export const ZOMBIE_PLAGUE_RAISE_EVERY = 5;

/**
 * Tank Death Burst: when a Tank hero dies, they deal this fraction of
 * the current attacker army as casualties — a devastating last act that
 * punishes the player for finally bringing them down.
 */
export const TANK_DEATH_BURST_FRACTION = 0.05;

/**
 * Hero-specific combat tuning (isolated experiment). All Hero survivability
 * and anti-chaff damage lives here so it can be tuned without touching any
 * other combat math. Normal units never consult these values.
 */
export const HERO_COMBAT_TUNING = {
  /**
   * Fraction of incoming damage negated for a LONE Hero. Incoming drain
   * runs through the swarm-mass curve (below); the lone reduction then
   * scales what remains.
   */
  loneDamageReduction: 0.6,
  /** Extra reduction per sqrt(extra living Hero): strong then diminishing. */
  allyBonusPerSqrtStep: 0.18,
  /** Living-Hero count at which the pack bonus stops growing. */
  allyBonusCapCount: 5,
  /** Hard ceiling on total damage reduction across all sources. */
  maxTotalReduction: 0.85,

  // --- Damage IN: swarm-mass incoming curve ---
  /**
   * Attacker headcount enters the swarm mass with this exponent (<1 =
   * strong diminishing returns: ten times the bodies is far less than
   * ten times the threat).
   */
  swarmMassExponent: 0.85,
  /**
   * Individual victim unit quality compounds with this exponent, so a few
   * high-CP units threaten a Hero far more than hordes of chaff.
   */
  unitCpExponent: 0.3,
  /**
   * Saturation point of the incoming fraction: an attacker swarm whose
   * mass equals this value drains at half the base rate. Lower = armies
   * cross into lethal territory sooner.
   */
  swarmMassHalf: 800,
  /** Base per-tick resolve-drain rate before saturation and reductions. */
  incomingBaseRate: 1.35,

  // --- Damage OUT: cleave swing + per-Hero kill budget ---
  /**
   * Flat bodies a Hero's swing carves from low-tier victims each combat
   * resolution, split across stacks by inverse-CP weight and scaled by
   * the victim-tier multiplier. Stacks ON TOP of the proportional share
   * carve — this is what lets one Hero delete hundreds of Wraiths in a
   * single resolution regardless of army size.
   */
  cleaveBodiesPerResolution: 300,
  /**
   * Per-Hero cap on total kills per resolution, denominated in PRE-tier
   * "swing units": a recruit-band (x3) stack spends 1 swing unit per 3
   * bodies lost, a commander-band (x1) stack 1 per body. Keeps mega-swarms
   * from vaporizing instantly (sustained war) while letting Skeletons
   * outlast Wraiths under equal fire.
   */
  swingUnitsPerResolutionPerHero: 180,
  /**
   * Threat intensity that maps to a 1.0x kill budget. Stronger (nemesis,
   * last-stand) Heroes raise their budget proportionally, so threat
   * strength differentiates damage even when the budget binds.
   */
  budgetThreatBaseline: 0.04,
} as const;

/**
 * Hero casualty multiplier against troop tiers — strongest vs low tiers,
 * no bonus vs Commander/Hero. Keyed by UnitTier.
 */
export const HERO_TIER_DAMAGE_MULTIPLIER: Record<UnitTier, number> = {
  recruit: 3,
  trained: 2,
  veteran: 1.5,
  elite: 1.25,
  commander: 1,
  hero: 1,
};

/**
 * Victim-stack tier classification by combat power, used because player
 * stacks carry no explicit tier field. First matching band wins; above the
 * last band a stack counts as 'commander' (no Hero bonus).
 */
export const HERO_VICTIM_TIER_BY_CP: readonly {
  readonly maxCp: number;
  readonly tier: UnitTier;
}[] = [
  { maxCp: 1, tier: 'recruit' }, // Wraith(1) ≈ enemy Recruit(1)
  { maxCp: 10, tier: 'trained' }, // Skeleton(2), Zombie(6) — outlast Wraiths
  { maxCp: 40, tier: 'elite' }, // Flesh Golem(25) ≈ enemy Elite(20)
];

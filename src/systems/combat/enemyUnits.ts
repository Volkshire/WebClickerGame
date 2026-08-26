import type { UnitTag, UnitTier, UnitType } from './unitTypes';
import { pickUnique } from './heroNames';
import { HERO_RESOLVE_BASE } from './pacing';
import { TACTIC_IDS } from './tactics';
import { HERO_CLASS_LOADOUTS, pickHeroClass } from './heroClasses';
import type { HeroClass } from './heroClasses';

/**
 * Ability descriptor attached to special units (Heroes today, Commanders
 * later). The engine interprets the `kind`s it knows and ignores unknown
 * ones, so new abilities never require touching the resolution core.
 */
export interface EnemyUnitAbility {
  kind: string;
  /** Meaning depends on `kind`; documented next to each known kind. */
  strength?: number;
}

/** Known ability kinds interpreted by the simulation. */
export const ABILITY_KINDS = {
  /**
   * Heroic Threat: per combat tick, removes `strength` × (player's current
   * troop total) additional troops, split proportionally across the player's
   * unit groups.
   */
  heroicThreat: 'heroic-threat',
} as const;

/** Flat per-tick drain for a fresh Hero's presence. */
const HERO_THREAT_FRESH = 0.04;
/** Nemesis ramp ceiling — returning veterans are meaningfully worse. */
const HERO_THREAT_NEMESIS_CAP = 0.08;

export interface EnemyUnitDefinition {
  id: string;
  name: string;
  type: UnitType;
  tier: UnitTier;
  combatPower: number;
  tags: readonly UnitTag[];
  isHero?: boolean;
  ability?: EnemyUnitAbility;
  /**
   * Hero-only effective HP. Attrition drains resolve before the hero can
   * die; regular units never set it (they die by fraction as always).
   */
  resolve?: number;
  /**
   * Combat-ability ids this unit brings into battle (Commander Tactics
   * today), resolved against the simulation's ability registry.
   */
  tactics?: readonly string[];
  /** Hidden hero class for hero units; determines skill loadout. */
  heroClass?: HeroClass;
}

function melee(id: string, name: string, tier: UnitTier, cp: number, tags: readonly UnitTag[] = []): EnemyUnitDefinition {
  return { id, name, type: 'melee', tier, combatPower: cp, tags };
}

function ranged(id: string, name: string, tier: UnitTier, cp: number, tags: readonly UnitTag[] = []): EnemyUnitDefinition {
  return { id, name, type: 'ranged', tier, combatPower: cp, tags };
}

/** Every commander-band officer leads with the shipped tactic loadout. */
const COMMANDER_TACTICS: readonly string[] = [
  TACTIC_IDS.pressTheAssault,
  TACTIC_IDS.rally,
  TACTIC_IDS.volleyFire,
];

/** Commander-tier unit wrapped with its tactic loadout (type preserved). */
function commander(id: string, name: string, cp: number, attackType: UnitType = 'melee'): EnemyUnitDefinition {
  const base =
    attackType === 'ranged'
      ? ranged(id, name, 'commander', cp, ['armored'])
      : melee(id, name, 'commander', cp, ['armored']);
  return { ...base, tactics: COMMANDER_TACTICS };
}

/**
 * Master registry of every enemy unit definition. Availability is NOT
 * granted by appearing here: each Age declares which of these ids its
 * garrisons may field (see AgeDefinition.enemyUnits in world.ts), so adding
 * or rebalancing a unit never touches the combat engine.
 *
 * Convention: within an Age every combat power is a multiple of that Age's
 * cheapest unit, keeping army compositions exactly expressible.
 */
export const ENEMY_UNITS: Record<string, EnemyUnitDefinition> = {
  // --- Age of Ash (proof-system roster, historical values) ---
  'recruit-melee': melee('recruit-melee', 'Recruit Melee', 'recruit', 1),
  'recruit-ranged': ranged('recruit-ranged', 'Recruit Ranged', 'recruit', 1),
  'trained-melee': melee('trained-melee', 'Trained Melee', 'trained', 3),
  'trained-ranged': ranged('trained-ranged', 'Trained Ranged', 'trained', 3),
  'veteran-melee': melee('veteran-melee', 'Veteran Melee', 'veteran', 8),
  'veteran-ranged': ranged('veteran-ranged', 'Veteran Ranged', 'veteran', 8),
  'elite-melee': melee('elite-melee', 'Elite Melee', 'elite', 20, ['armored']),
  'elite-ranged': ranged('elite-ranged', 'Elite Ranged', 'elite', 20, ['armored']),
  commander: commander('commander', 'Commander', 60),

  // --- Age of Iron ---
  'iron-militia': melee('iron-militia', 'Iron Militia', 'recruit', 4),
  'iron-archer': ranged('iron-archer', 'Iron Archer', 'recruit', 4),
  'iron-man-at-arms': melee('iron-man-at-arms', 'Man-at-Arms', 'trained', 12, ['armored']),
  'iron-longbowman': ranged('iron-longbowman', 'Longbowman', 'trained', 16),
  knight: melee('knight', 'Knight', 'veteran', 32, ['armored']),
  'iron-captain': commander('iron-captain', 'Iron Captain', 96),

  // --- Age of Kings ---
  'kings-levy': melee('kings-levy', "King's Levy", 'recruit', 40),
  'kings-crossbow': ranged('kings-crossbow', 'Crossbowman', 'recruit', 40),
  'kings-guard': melee('kings-guard', "King's Guard", 'trained', 120, ['armored']),
  'kings-cataphract': melee('kings-cataphract', 'Cataphract', 'elite', 400, ['armored']),
  'kings-champion': commander('kings-champion', "King's Champion", 1200),

  // --- Age of Empires ---
  'empire-legionary': melee('empire-legionary', 'Legionary', 'recruit', 200),
  'empire-sagittarius': ranged('empire-sagittarius', 'Sagittarius', 'recruit', 200),
  'empire-praetorian': melee('empire-praetorian', 'Praetorian', 'elite', 600, ['armored']),
  'empire-war-elephant': melee('empire-war-elephant', 'War Elephant', 'veteran', 2000, ['armored']),
  'empire-legate': commander('empire-legate', 'Legate', 6000),

  // --- Age of Castles ---
  'castles-footman': melee('castles-footman', 'Castle Footman', 'recruit', 1000),
  'castles-arbalest': ranged('castles-arbalest', 'Arbalest', 'recruit', 1000),
  'castles-castellan': melee('castles-castellan', 'Castellan', 'elite', 3000, ['armored']),
  'castles-trebuchet': ranged('castles-trebuchet', 'Trebuchet Crew', 'veteran', 10000),
  'castles-lord': commander('castles-lord', 'Castle Lord', 30000),

  // --- Age of Gunpowder ---
  'gunpowder-pikeman': melee('gunpowder-pikeman', 'Pikeman', 'recruit', 5000),
  'gunpowder-musketeer': ranged('gunpowder-musketeer', 'Musketeer', 'recruit', 5000),
  'gunpowder-grenadier': melee('gunpowder-grenadier', 'Grenadier', 'elite', 15000, ['armored']),
  'gunpowder-cannon': ranged('gunpowder-cannon', 'Field Cannon', 'veteran', 50000),
  'gunpowder-general': commander('gunpowder-general', 'General', 150000),

  // --- Age of Industry ---
  'industry-rifler': ranged('industry-rifler', 'Rifler', 'recruit', 50000),
  'industry-sapper': melee('industry-sapper', 'Sapper', 'recruit', 50000),
  'industry-ironclad': melee('industry-ironclad', 'Ironclad Trooper', 'elite', 150000, ['armored']),
  'industry-artillery': ranged('industry-artillery', 'Heavy Artillery', 'veteran', 500000),
  'industry-warlord': commander('industry-warlord', 'Industrial Warlord', 1500000),

  // --- Age of Machines ---
  'machines-drone': ranged('machines-drone', 'Autonomous Drone', 'recruit', 500000),
  'machines-hunter': melee('machines-hunter', 'Hunter-Killer', 'recruit', 500000),
  'machines-automaton': melee('machines-automaton', 'War Automaton', 'elite', 1500000, ['armored']),
  'machines-doom-engine': melee('machines-doom-engine', 'Doom Engine', 'veteran', 5000000, ['armored']),
  'machines-overseer': commander('machines-overseer', 'Machine Overseer', 15000000, 'ranged'),

  // --- Age of Steel ---
  'steel-infantryman': melee('steel-infantryman', 'Steel Infantry', 'recruit', 5000000),
  'steel-marksman': ranged('steel-marksman', 'Steel Marksman', 'recruit', 5000000),
  'steel-sentinel': melee('steel-sentinel', 'Steel Sentinel', 'elite', 15000000, ['armored']),
  'steel-juggernaut': melee('steel-juggernaut', 'Juggernaut', 'veteran', 50000000, ['armored']),
  'steel-archon': commander('steel-archon', 'Steel Archon', 150000000),

  // --- Age of Ruin ---
  'ruin-thrall': melee('ruin-thrall', 'Ashen Thrall', 'recruit', 50000000),
  'ruin-stalker': ranged('ruin-stalker', 'Ruin Stalker', 'recruit', 50000000),
  'ruin-colossus': melee('ruin-colossus', 'Hollow Colossus', 'elite', 150000000, ['armored']),
  'ruin-worldbreaker': melee('ruin-worldbreaker', 'Worldbreaker', 'veteran', 500000000, ['armored']),
  'ruin-sovereign': commander('ruin-sovereign', 'Ruin Sovereign', 1500000000),
};

/**
 * Resolve grows with campaign order: early Heroes are fragile skirmishers,
 * late-campaign legends take serious grinding. Order 1-2 → 5, order 10 → 8.
 */
export function heroResolveForOrder(order: number): number {
  const bonus = Number.isFinite(order) && order > 0 ? Math.floor(order / 3) : 0;
  return HERO_RESOLVE_BASE + bonus;
}

/**
 * Per-class resolve modifier. Support heroes need extra resolve so they
 * survive long enough to use their revival passive on fallen allies. Tanks
 * get a smaller bonus for their frontline role. This prevents the "all
 * heroes die simultaneously" problem where identical resolve pools cause
 * identical death timing, giving the Support passive a window to fire.
 */
const HERO_CLASS_RESOLVE_BONUS: Record<HeroClass, number> = {
  caster: 0,
  ranged: 0,
  support: 3,
  tank: 2,
};

const HERO_UNIT: EnemyUnitDefinition = {
  id: 'hero',
  name: 'Hero',
  type: 'melee',
  tier: 'hero',
  combatPower: 200,
  tags: ['armored'],
  isHero: true,
  ability: { kind: ABILITY_KINDS.heroicThreat, strength: HERO_THREAT_FRESH },
  resolve: HERO_RESOLVE_BASE,
  tactics: HERO_CLASS_LOADOUTS.caster,
  heroClass: 'caster',
};

export function createHeroForTarget(
  target: { combatPower: number; order: number },
  name?: string,
  nemesis?: boolean,
  heroClass?: HeroClass,
): EnemyUnitDefinition {
  const cp = Math.max(200, Math.round(target.combatPower * 0.06));
  // Nemeses ramp with campaign order up to the cap — a returning veteran is
  // a known, feared quantity by the late campaign.
  const threat = Math.min(
    HERO_THREAT_NEMESIS_CAP,
    HERO_THREAT_FRESH + 0.004 * target.order,
  );
  const resolvedClass = heroClass ?? 'caster';
  return {
    id: 'hero',
    name: name ?? 'Hero',
    type: 'melee',
    tier: 'hero',
    combatPower: cp,
    tags: ['armored'],
    isHero: true,
    ability: {
      kind: ABILITY_KINDS.heroicThreat,
      strength: nemesis ? threat : HERO_THREAT_FRESH,
    },
    resolve: heroResolveForOrder(target.order) + (HERO_CLASS_RESOLVE_BONUS[resolvedClass] ?? 0),
    tactics: HERO_CLASS_LOADOUTS[resolvedClass],
    heroClass: resolvedClass,
  };
}

export function getEnemyUnit(unitId: string): EnemyUnitDefinition | null {
  if (unitId === HERO_UNIT.id) return HERO_UNIT;
  return ENEMY_UNITS[unitId] ?? null;
}

/** One line of a target army composition. */
export interface ArmyCompositionEntry {
  unitId: string;
  quantity: number;
}

/** A concrete rolled army: definitions joined with counts. */
export interface RolledArmyGroup extends EnemyUnitDefinition {
  count: number;
  /** True when this Hero is a fled veteran returning via the grudge system. */
  isReturningNemesis?: boolean;
  /** True when this Hero survived a previous failed assault on this target. */
  isReturningDefender?: boolean;
  /** Hidden hero class for hero units. */
  heroClass?: HeroClass;
}

export const MAX_HEROES_PER_TARGET = 2;

/** Chance an ordinary hero slot is hijacked by an owed fled Hero. */
export const NEMESIS_HIJACK_CHANCE = 0.5;

/**
 * Expands a target's base composition and rolls Heroes on top:
 * one independent roll per hero slot, so a target yields 0–2 heroes.
 * Heroes scale off the target's configured power via createHeroForTarget,
 * and owed fled Heroes may claim slots (guaranteed on the final target).
 * Hero CP is variance layered over the target's configured power —
 * target 1 can never roll any because its chance is 0.
 */
export function rollTargetArmy(
  entries: readonly ArmyCompositionEntry[],
  heroChance: number,
  rng: () => number,
  names?: readonly string[],
  currentTargetOrder?: number,
  fledHeroes?: readonly { name: string; fledOrder: number }[],
  isFinalTarget?: boolean,
  targetCombatPower?: number,
  /** Shuffle-bag draw for fresh identities; falls back to uniform picking. */
  drawHeroName?: (excluded: ReadonlySet<string>) => string | undefined,
  /**
   * Heroes that survived a previous failed assault on THIS target. They
   * always take the field again; outside Age finales they LOCK the roster
   * (repeat attacks face exactly them, nobody else).
   */
  standingHeroes?: readonly string[],
): RolledArmyGroup[] {
  const finalTarget = isFinalTarget === true;
  const groups: RolledArmyGroup[] = [];
  for (const entry of entries) {
    const def = getEnemyUnit(entry.unitId);
    if (def === null || entry.quantity < 1) continue;
    groups.push({ ...def, count: entry.quantity });
  }

  const heroPool = names ? names.filter((n) => n.length > 0) : [];

  // Fled Heroes become eligible once at least one target has passed since
  // their flight — enough time for the grudge to travel.
  const standingSet = new Set((standingHeroes ?? []).map((n) => n.toLowerCase()));
  const fledPool = [...(fledHeroes ?? [])].filter(
    (f) =>
      currentTargetOrder !== undefined &&
      f.fledOrder < currentTargetOrder &&
      !standingSet.has(f.name.toLowerCase()),
  );
  let fledIndex = 0;

  /** Names already worn by Heroes on this battlefield, plus every reserved
   * grudge identity — fresh picks must never duplicate a fled veteran. */
  const usedNames = (): Set<string> => {
    const seen = new Set<string>();
    for (const fled of fledPool) seen.add(fled.name.toLowerCase());
    for (const group of groups) {
      if (group.isHero === true && group.name !== 'Hero') {
        seen.add(group.name.toLowerCase());
      }
    }
    return seen;
  };

  /**
   * Resolves who steps into a rolled hero slot: an owed fled veteran
   * (guaranteed on the final target, hijack chance otherwise) or a fresh
   * pool name. Returns the display name plus whether they are a nemesis.
   */
  const pickHeroIdentity = (): { name: string; returning: boolean } => {
    if (fledIndex < fledPool.length && (finalTarget || rng() < NEMESIS_HIJACK_CHANCE)) {
      const name = fledPool[fledIndex].name;
      fledIndex += 1;
      return { name, returning: true };
    }
    // Fresh identity: shuffle-bag first (no repeats until the pool
    // depletes), uniform fallback when no deck is supplied.
    const drawn = drawHeroName?.(usedNames());
    const name = drawn ?? pickUnique(heroPool, usedNames(), rng) ?? 'Hero';
    return { name, returning: false };
  };

  /** Builds a fresh scaled hero stack from a picked identity. */
  const buildHero = (identity: { name: string; returning: boolean }): RolledArmyGroup => {
    // Assign a class: returning heroes keep a default class (caster);
    // fresh heroes avoid duplicating classes already on the field.
    const existingClasses = groups
      .filter((g) => g.isHero === true)
      .map((g) => g.heroClass)
      .filter((c): c is HeroClass => c !== undefined);
    const resolvedClass = identity.returning ? 'caster' : pickHeroClass(existingClasses, rng);
    return {
      ...createHeroForTarget(
        { combatPower: targetCombatPower ?? 0, order: currentTargetOrder ?? 0 },
        identity.name,
        identity.returning,
        resolvedClass,
      ),
      count: 1,
      ...(identity.returning ? { isReturningNemesis: true } : {}),
    };
  };

  // Standing defenders from a previous failed assault hold their ground.
  // Outside Age finales they LOCK the roster: repeat attacks face exactly
  // these Heroes and nobody else. On a finale they still claim slots first,
  // but the normal escalation pipeline fills whatever remains.
  // Keep-FIRST casing: later duplicate spellings must never overwrite the
  // canonical display form already recorded.
  const survivorByKey = new Map<string, string>();
  for (const name of standingHeroes ?? []) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (!survivorByKey.has(key)) {
      survivorByKey.set(key, trimmed.replace(/(^|\s)\S/g, (c) => c.toUpperCase()));
    }
  }
  const survivors = [...survivorByKey.values()].slice(0, MAX_HEROES_PER_TARGET);
  const rosterLocked = survivors.length > 0 && !finalTarget;
  for (const name of survivors) {
    const existingClasses = groups
      .filter((g) => g.isHero === true)
      .map((g) => g.heroClass)
      .filter((c): c is HeroClass => c !== undefined);
    const defenderClass = pickHeroClass(existingClasses, rng);
    groups.push({
      ...createHeroForTarget(
        { combatPower: targetCombatPower ?? 0, order: currentTargetOrder ?? 0 },
        name,
        false,
        defenderClass,
      ),
      count: 1,
      isReturningDefender: true,
    });
  }

  if (rosterLocked) return groups;

  const freeSlots = Math.max(0, MAX_HEROES_PER_TARGET - survivors.length);
  for (let slot = 0; slot < freeSlots; slot += 1) {
    if (rng() >= heroChance) continue;
    // Every Hero takes the field as their OWN individual stack with their
    // own name. (Merging slots into one stack used to erase the second
    // Hero's identity and left only one grudge entry behind.)
    groups.push(buildHero(pickHeroIdentity()));
  }

  // Guarantee beats cap: any owed fled Heroes beyond MAX_HEROES_PER_TARGET
  // still take the field on the final target.
  while (finalTarget && fledIndex < fledPool.length) {
    groups.push(buildHero({ name: fledPool[fledIndex].name, returning: true }));
    fledIndex += 1;
  }

  return groups;
}
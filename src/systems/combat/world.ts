import type { ResourceId } from '../resources/types';
import type { TerrainType } from './terrain';
import { getEnemyUnit } from './enemyUnits';
import type { ArmyCompositionEntry, EnemyUnitDefinition } from './enemyUnits';
import type { EnemySpecialEntitySpawnConfig } from './enemyUnits';
import { type UnitTier } from './unitTypes';

/**
 * Loot granted per enemy casualty. CombatSystem multiplies this table by
 * enemy casualties into BattleResult.lootGained (reporting only); the
 * wiring layer performs the actual resource grants.
 */
export type TargetLootTable = Partial<Record<ResourceId, number>>;

export interface TargetDefinition {
  id: string;
  name: string;
  /**
   * Total defender power, DERIVED from `army`: the composition's weighted
   * sum must equal this exactly (asserted at module load), keeping the
   * configured progression values authoritative.
   */
  combatPower: number;
  /** Enemy army composition; Heroes are rolled per battle, never listed here. */
  army: readonly ArmyCompositionEntry[];
  /**
   * Independent roll chance per Hero slot (max 2). Target 1 must stay 0;
   * later targets rise steeply.
   */
  heroChance: number;
  terrain: TerrainType;
  /** Resources awarded per enemy casualty when this target is defeated. */
  loot: TargetLootTable;
  /** 1-based position inside its Age; targets unlock strictly in this order. */
  order: number;
  /** Optional flavor text about the target. */
  flavorText?: string;
}

/**
 * One Age of the world campaign. Everything about an Age — its identity,
 * which enemies it may field, and its whole target ladder — lives here as
 * data. Adding, removing, renaming or reordering Ages means editing this
 * array; the combat engine and progression code stay untouched.
 *
 * Target ids must be unique ACROSS Ages (prefix new Ages' slugs), because
 * saves reference battles by target id alone.
 */
export interface AgeDefinition {
  id: string;
  name: string;
  /** Enemy unit ids this Age may field; availability is data-driven. */
  enemyUnits: readonly string[];
  /** The Age's campaign ladder, in strict progression order. */
  targets: readonly TargetDefinition[];
  /** Optional replacement for the default human-Hero slot pool. */
  specialEntitySpawn?: EnemySpecialEntitySpawnConfig;
}

// ---------------------------------------------------------------------------
// Shared campaign pacing ladders — per-position values mirroring the
// historical Age of Ash ladder so every Age feels consistent. Individual
// Ages may override any of these by declaring literal targets instead.
// ---------------------------------------------------------------------------

/** Independent Hero-slot roll chance per target position. */
const CAMPAIGN_HERO_CHANCE = [0, 0.1, 0.18, 0.3, 0.42, 0.55, 0.7, 0.82, 0.92, 0.95] as const;

/** Per-casualty loot table per target position. */
const CAMPAIGN_LOOT: readonly TargetLootTable[] = [
  { bone: 1 },
  { bone: 1, flesh: 1 },
  { bone: 1, flesh: 1, iron: 1 },
  { bone: 2, flesh: 2, iron: 1 },
  { bone: 2, flesh: 2, iron: 2 },
  { bone: 2, flesh: 2, iron: 2 },
  { bone: 3, flesh: 3, iron: 2 },
  { bone: 3, flesh: 3, iron: 3 },
  { bone: 3, flesh: 3, iron: 3 },
  { bone: 4, flesh: 4, iron: 4 },
];

/** Terrain per target position. */
const CAMPAIGN_TERRAIN: readonly TerrainType[] = [
  'settlement',
  'plains',
  'walled-settlement',
  'settlement',
  'walled-settlement',
  'settlement',
  'fortress',
  'settlement',
  'settlement',
  'fortress',
];

/**
 * Provisional shared target names/slugs. Every Age reuses these for now;
 * later each Age gets thematic names by editing its own ladder only.
 */
const TARGET_NAMES = [
  'Village',
  'Large Settlement',
  'Walled Town',
  'Grand Town',
  'Fortified City',
  'Temple City',
  'Royal Fortress',
  'Kingdom Capital',
  'Great Kingdom',
  'Imperial Stronghold',
] as const;

const TARGET_SLUGS = [
  'village',
  'large-settlement',
  'walled-town',
  'grand-town',
  'fortified-city',
  'temple-city',
  'royal-fortress',
  'kingdom-capital',
  'great-kingdom',
  'imperial-stronghold',
] as const;

/**
 * Share of an Age's total power each tier is allowed to carry. Cheaper
 * tiers dominate the headcount (real cannon fodder), commanders stay a
 * thin officer layer. Normalized over the tiers actually present in a pool,
 * so pools without, say, a trained unit still sum to 100%.
 */
const TIER_CP_SHARE: Record<UnitTier, number> = {
  recruit: 0.3,
  trained: 0.14,
  veteran: 0.08,
  elite: 0.07,
  commander: 0.04,
  // Heroes never appear in static compositions.
  hero: 0,
};

interface ComposerEntry {
  id: string;
  /** Combat power in units of the pool's cheapest CP (integer by convention). */
  base: number;
  /** Desired count before rounding. */
  desired: number;
  quantity: number;
}

/**
 * Deterministic army composer: splits `totalCp` across the Age's pool by
 * tier weight so garrisons come out as believable mixed armies — massed
 * cheap troops with a thin elite/commander layer — instead of one dominant
 * stack. All math runs on the CP lattice the integrity assert enforces:
 * every unit CP in a pool is a multiple of that pool's cheapest CP and every
 * target CP is too, so integer largest-remainder allocation can always land
 * on the total EXACTLY.
 */
function composeArmy(unitIds: readonly string[], totalCp: number): ArmyCompositionEntry[] {
  const defs: EnemyUnitDefinition[] = [];
  for (const id of unitIds) {
    const def = getEnemyUnit(id);
    if (def === null) throw new Error(`composeArmy: unknown enemy unit "${id}".`);
    defs.push(def);
  }
  if (defs.length === 0) throw new Error('composeArmy: empty unit pool.');

  const cheapestCp = Math.min(...defs.map((def) => def.combatPower));
  const totalBase = totalCp / cheapestCp;
  if (!Number.isInteger(totalBase)) {
    throw new Error(`composeArmy: ${totalCp} CP is not a multiple of cheapest CP ${cheapestCp}.`);
  }

  const shareSum = defs.reduce((sum, def) => sum + TIER_CP_SHARE[def.tier], 0);
  const entries: ComposerEntry[] = defs.map((def) => {
    const base = def.combatPower / cheapestCp;
    if (!Number.isInteger(base)) {
      throw new Error(
        `composeArmy: unit "${def.id}" CP ${def.combatPower} breaks the lattice of ${cheapestCp}.`,
      );
    }
    return {
      id: def.id,
      base,
      desired: (TIER_CP_SHARE[def.tier] / shareSum) * (totalBase / base),
      quantity: 0,
    };
  });

  for (const entry of entries) entry.quantity = Math.floor(entry.desired);
  let remaining = totalBase - entries.reduce((sum, e) => sum + e.quantity * e.base, 0);

  // Largest-remainder pass: hand whole units to the most under-allocated
  // stacks while they fit. Ties break deterministically (cheaper first).
  const byRemainder = [...entries].sort(
    (a, b) => b.desired - b.quantity - (a.desired - a.quantity) || a.base - b.base || a.id.localeCompare(b.id),
  );
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (const entry of byRemainder) {
      if (entry.base > remaining) continue;
      entry.quantity += 1;
      remaining -= entry.base;
      progress = true;
    }
  }

  // The cheapest unit has base 1 and always fits — any residue lands there.
  const cheapest = entries.reduce((min, e) => (e.base < min.base ? e : min), entries[0]);
  cheapest.quantity += remaining;
  remaining = 0;

  if (remaining !== 0) {
    // Load-time loud failure: a misconfigured pool/CP pair can never silently
    // produce a wrong-power garrison.
    throw new Error(
      `composeArmy: cannot express ${totalCp} CP exactly from the given pool (leftover ${remaining}).`,
    );
  }
  return entries
    .filter((entry) => entry.quantity > 0)
    .map((entry) => ({ unitId: entry.id, quantity: entry.quantity }));
}

interface LadderSpec {
  /** Prefix for target ids, keeping them unique across Ages ("iron-..."). */
  prefix: string;
  /** Hand-authored combat power for each target position. */
  combatPowers: readonly number[];
  /** Optional per-position flavor text. */
  flavorTexts?: readonly (string | undefined)[];
}

/** Builds one Age's ten-target ladder from its authored configuration. */
function ladderTargets(spec: LadderSpec, unitIds: readonly string[]): TargetDefinition[] {
  if (spec.combatPowers.length !== TARGET_NAMES.length) {
    throw new Error(`Ladder "${spec.prefix}" must define exactly ${TARGET_NAMES.length} powers.`);
  }
  return spec.combatPowers.map((combatPower, index) => ({
    id: `${spec.prefix}${TARGET_SLUGS[index]}`,
    name: TARGET_NAMES[index],
    combatPower,
    army: composeArmy(unitIds, combatPower),
    heroChance: CAMPAIGN_HERO_CHANCE[index],
    terrain: CAMPAIGN_TERRAIN[index],
    loot: { ...CAMPAIGN_LOOT[index] },
    order: index + 1,
    ...(spec.flavorTexts?.[index] !== undefined ? { flavorText: spec.flavorTexts[index] } : {}),
  }));
}

// ---------------------------------------------------------------------------
// The Ages, in progression order. Age of Ash keeps its historical literal
// ladder; every later Age declares its own power curve + roster below.
// ---------------------------------------------------------------------------

const ASH_UNITS = [
  'recruit-melee',
  'recruit-ranged',
  'trained-melee',
  'trained-ranged',
  'veteran-melee',
  'veteran-ranged',
  'elite-melee',
  'elite-ranged',
  'commander',
] as const;

const ASH_TARGETS: TargetDefinition[] = [
  {
    id: 'village',
    name: 'Village',
    combatPower: 100,
    army: [
      { unitId: 'recruit-melee', quantity: 60 },
      { unitId: 'recruit-ranged', quantity: 40 },
    ],
    heroChance: 0,
    terrain: 'settlement',
    loot: { bone: 1 },
    order: 1,
    flavorText: 'Humble homes of the living — the harvest begins unnoticed.',
  },
  {
    id: 'large-settlement',
    name: 'Large Settlement',
    combatPower: 300,
    army: [
      { unitId: 'trained-melee', quantity: 20 },
      { unitId: 'trained-ranged', quantity: 40 },
      { unitId: 'recruit-melee', quantity: 60 },
      { unitId: 'recruit-ranged', quantity: 60 },
    ],
    heroChance: 0.1,
    terrain: 'plains',
    loot: { bone: 1, flesh: 1 },
    order: 2,
    flavorText: 'Smoke rises from crowded streets as word of the pale death spreads.',
  },
  {
    id: 'walled-town',
    name: 'Walled Town',
    combatPower: 900,
    army: [
      { unitId: 'veteran-melee', quantity: 30 },
      { unitId: 'trained-ranged', quantity: 80 },
      { unitId: 'trained-melee', quantity: 100 },
      { unitId: 'recruit-ranged', quantity: 120 },
    ],
    heroChance: 0.18,
    terrain: 'walled-settlement',
    loot: { bone: 1, flesh: 1, iron: 1 },
    order: 3,
    flavorText: 'Stone walls mock the dead, until the gates are stained red from within.',
  },
  {
    id: 'grand-town',
    name: 'Grand Town',
    combatPower: 2500,
    army: [
      { unitId: 'veteran-melee', quantity: 150 },
      { unitId: 'veteran-ranged', quantity: 100 },
      { unitId: 'trained-ranged', quantity: 100 },
      { unitId: 'trained-melee', quantity: 40 },
      { unitId: 'recruit-melee', quantity: 80 },
    ],
    heroChance: 0.3,
    terrain: 'settlement',
    loot: { bone: 2, flesh: 2, iron: 1 },
    order: 4,
    flavorText: 'Wealth bred pride here. Pride makes the marrow taste sweeter.',
  },
  {
    id: 'fortified-city',
    name: 'Fortified City',
    combatPower: 7000,
    army: [
      { unitId: 'elite-melee', quantity: 120 },
      { unitId: 'elite-ranged', quantity: 90 },
      { unitId: 'veteran-melee', quantity: 250 },
      { unitId: 'veteran-ranged', quantity: 100 },
    ],
    heroChance: 0.42,
    terrain: 'walled-settlement',
    loot: { bone: 2, flesh: 2, iron: 2 },
    order: 5,
    flavorText: 'Banners and bastions cannot stop what already owns the night.',
  },
  {
    id: 'temple-city',
    name: 'Temple City',
    combatPower: 18000,
    army: [
      { unitId: 'elite-melee', quantity: 400 },
      { unitId: 'elite-ranged', quantity: 350 },
      { unitId: 'veteran-melee', quantity: 250 },
      { unitId: 'veteran-ranged', quantity: 50 },
      { unitId: 'commander', quantity: 10 },
    ],
    heroChance: 0.55,
    terrain: 'settlement',
    loot: { bone: 2, flesh: 2, iron: 2 },
    order: 6,
    flavorText: 'They pray louder now. The gods have stopped answering.',
  },
  {
    id: 'royal-fortress',
    name: 'Royal Fortress',
    combatPower: 45000,
    army: [
      { unitId: 'elite-melee', quantity: 900 },
      { unitId: 'elite-ranged', quantity: 800 },
      { unitId: 'veteran-melee', quantity: 800 },
      { unitId: 'veteran-ranged', quantity: 300 },
      { unitId: 'commander', quantity: 35 },
      { unitId: 'recruit-ranged', quantity: 100 },
    ],
    heroChance: 0.7,
    terrain: 'fortress',
    loot: { bone: 3, flesh: 3, iron: 2 },
    order: 7,
    flavorText: "The crown's last shield stands watch over a court of cowards.",
  },
  {
    id: 'kingdom-capital',
    name: 'Kingdom Capital',
    combatPower: 110000,
    army: [
      { unitId: 'elite-melee', quantity: 2300 },
      { unitId: 'elite-ranged', quantity: 2200 },
      { unitId: 'veteran-melee', quantity: 1500 },
      { unitId: 'veteran-ranged', quantity: 700 },
      { unitId: 'commander', quantity: 40 },
    ],
    heroChance: 0.82,
    terrain: 'settlement',
    loot: { bone: 3, flesh: 3, iron: 3 },
    order: 8,
    flavorText: 'A city of a million hearts — enough to feed the legion for an age.',
  },
  {
    id: 'great-kingdom',
    name: 'Great Kingdom',
    combatPower: 275000,
    army: [
      { unitId: 'elite-melee', quantity: 5000 },
      { unitId: 'elite-ranged', quantity: 5150 },
      { unitId: 'veteran-melee', quantity: 4000 },
      { unitId: 'veteran-ranged', quantity: 2000 },
      { unitId: 'commander', quantity: 400 },
    ],
    heroChance: 0.92,
    terrain: 'settlement',
    loot: { bone: 3, flesh: 3, iron: 3 },
    order: 9,
    flavorText: 'Provinces kneel one by one; the map of the living is shrinking.',
  },
  {
    id: 'imperial-stronghold',
    name: 'Imperial Stronghold',
    combatPower: 700000,
    army: [
      { unitId: 'elite-melee', quantity: 13000 },
      { unitId: 'elite-ranged', quantity: 12500 },
      { unitId: 'veteran-melee', quantity: 9500 },
      { unitId: 'veteran-ranged', quantity: 6000 },
      { unitId: 'commander', quantity: 1100 },
    ],
    heroChance: 0.95,
    terrain: 'fortress',
    loot: { bone: 4, flesh: 4, iron: 4 },
    order: 10,
    flavorText: 'The throne of the living world. Its fall will echo through the ash of ages.',
  },
];

const IRON_UNITS = [
  'iron-militia',
  'iron-archer',
  'iron-man-at-arms',
  'iron-longbowman',
  'knight',
  'iron-captain',
] as const;

const KINGS_UNITS = [
  'kings-levy',
  'kings-crossbow',
  'kings-guard',
  'kings-cataphract',
  'kings-champion',
] as const;

const EMPIRES_UNITS = [
  'empire-legionary',
  'empire-sagittarius',
  'empire-praetorian',
  'empire-war-elephant',
  'empire-legate',
] as const;

const CASTLES_UNITS = [
  'castles-footman',
  'castles-arbalest',
  'castles-castellan',
  'castles-trebuchet',
  'castles-lord',
] as const;

const GUNPOWDER_UNITS = [
  'gunpowder-pikeman',
  'gunpowder-musketeer',
  'gunpowder-grenadier',
  'gunpowder-cannon',
  'gunpowder-general',
] as const;

const INDUSTRY_UNITS = [
  'industry-rifler',
  'industry-sapper',
  'industry-ironclad',
  'industry-artillery',
  'industry-warlord',
] as const;

const MACHINES_UNITS = [
  'machines-drone',
  'machines-hunter',
  'machines-automaton',
  'machines-doom-engine',
  'machines-overseer',
] as const;

const STEEL_UNITS = [
  'steel-infantryman',
  'steel-marksman',
  'steel-sentinel',
  'steel-juggernaut',
  'steel-archon',
] as const;

const RUIN_UNITS = [
  'ruin-thrall',
  'ruin-stalker',
  'ruin-colossus',
  'ruin-worldbreaker',
  'ruin-sovereign',
] as const;

export const AGES: readonly AgeDefinition[] = [
  {
    id: 'age-of-ash',
    name: 'Age of Ash',
    enemyUnits: ASH_UNITS,
    targets: ASH_TARGETS,
  },
  {
    id: 'age-of-iron',
    name: 'Age of Iron',
    enemyUnits: IRON_UNITS,
    targets: ladderTargets(
      {
        prefix: 'iron-',
        combatPowers: [1000, 3000, 9000, 25000, 70000, 180000, 450000, 1100000, 2750000, 7000000],
        flavorTexts: [
          'Forges glow on the horizon; iron replaces the ash-touched plough.',
          'Blacksmiths hammer day and night, arming the living against the dead.',
          'Behind iron-banded gates, militia drill with pike and shield.',
          'Mail-clad soldiers march beneath banners of freshly forged steel.',
          'Chainmail glitters on the walls like the scales of a waking beast.',
          'Anointed knights kneel in the cathedral, swearing oaths of fire.',
          "The realm's finest horsemen sharpen their blades for a holy war.",
          'Steel floods the capital; every street bristles with spearpoints.',
          'Armored columns stretch beyond the horizon, banners snapping in the wind.',
          'The imperial host stands in gleaming plate — the dead will earn every inch.',
        ],
      },
      IRON_UNITS,
    ),
  },
  {
    id: 'age-of-kings',
    name: 'Age of Kings',
    enemyUnits: KINGS_UNITS,
    targets: ladderTargets(
      {
        prefix: 'kings-',
        combatPowers: [
          10000, 30000, 90000, 250000, 700000, 1800000, 4500000, 11000000, 27500000, 70000000,
        ],
      },
      KINGS_UNITS,
    ),
  },
  {
    id: 'age-of-empires',
    name: 'Age of Empires',
    enemyUnits: EMPIRES_UNITS,
    targets: ladderTargets(
      {
        prefix: 'empires-',
        combatPowers: [
          100000, 300000, 900000, 2500000, 7000000, 18000000, 45000000, 110000000, 275000000,
          700000000,
        ],
      },
      EMPIRES_UNITS,
    ),
  },
  {
    id: 'age-of-castles',
    name: 'Age of Castles',
    enemyUnits: CASTLES_UNITS,
    targets: ladderTargets(
      {
        prefix: 'castles-',
        combatPowers: [
          1000000, 3000000, 9000000, 25000000, 70000000, 180000000, 450000000, 1100000000,
          2750000000, 7000000000,
        ],
      },
      CASTLES_UNITS,
    ),
  },
  {
    id: 'age-of-gunpowder',
    name: 'Age of Gunpowder',
    enemyUnits: GUNPOWDER_UNITS,
    targets: ladderTargets(
      {
        prefix: 'gunpowder-',
        combatPowers: [
          10000000, 30000000, 90000000, 250000000, 700000000, 1800000000, 4500000000,
          11000000000, 27500000000, 70000000000,
        ],
      },
      GUNPOWDER_UNITS,
    ),
  },
  {
    id: 'age-of-industry',
    name: 'Age of Industry',
    enemyUnits: INDUSTRY_UNITS,
    targets: ladderTargets(
      {
        prefix: 'industry-',
        combatPowers: [
          100000000, 300000000, 900000000, 2500000000, 7000000000, 18000000000, 45000000000,
          110000000000, 275000000000, 700000000000,
        ],
      },
      INDUSTRY_UNITS,
    ),
  },
  {
    id: 'age-of-machines',
    name: 'Age of Machines',
    enemyUnits: MACHINES_UNITS,
    specialEntitySpawn: { kind: 'mech', namePool: 'mech', maxPerTarget: 3 },
    targets: ladderTargets(
      {
        prefix: 'machines-',
        combatPowers: [
          1000000000, 3000000000, 9000000000, 25000000000, 70000000000, 180000000000,
          450000000000, 1100000000000, 2750000000000, 7000000000000,
        ],
      },
      MACHINES_UNITS,
    ),
  },
  {
    id: 'age-of-steel',
    name: 'Age of Steel',
    enemyUnits: STEEL_UNITS,
    targets: ladderTargets(
      {
        prefix: 'steel-',
        combatPowers: [
          10000000000, 30000000000, 90000000000, 250000000000, 700000000000, 1800000000000,
          4500000000000, 11000000000000, 27500000000000, 70000000000000,
        ],
      },
      STEEL_UNITS,
    ),
  },
  {
    id: 'age-of-ruin',
    name: 'Age of Ruin',
    enemyUnits: RUIN_UNITS,
    targets: ladderTargets(
      {
        prefix: 'ruin-',
        combatPowers: [
          100000000000, 300000000000, 900000000000, 2500000000000, 7000000000000,
          18000000000000, 45000000000000, 110000000000000, 275000000000000, 700000000000000,
        ],
      },
      RUIN_UNITS,
    ),
  },
];

/** Number of implemented Ages. The game must not assume this value anywhere. */
export const TOTAL_AGES = AGES.length;

export function getAgeByIndex(index: number): AgeDefinition | null {
  return AGES[index] ?? null;
}

export function getAgeById(id: string): AgeDefinition | null {
  return AGES.find((age) => age.id === id) ?? null;
}

/** A target resolved back to its owning Age (target ids are globally unique). */
export interface ResolvedTarget {
  age: AgeDefinition;
  ageIndex: number;
  target: TargetDefinition;
  targetIndex: number;
}

export function getAgeForTarget(targetId: string): ResolvedTarget | null {
  for (let ageIndex = 0; ageIndex < AGES.length; ageIndex += 1) {
    const age = AGES[ageIndex];
    const targetIndex = age.targets.findIndex((target) => target.id === targetId);
    if (targetIndex >= 0) {
      return { age, ageIndex, target: age.targets[targetIndex], targetIndex };
    }
  }
  return null;
}

/** Targets are globally unique; resolves across all Ages. */
export function getTargetDef(targetId: string): TargetDefinition | null {
  return getAgeForTarget(targetId)?.target ?? null;
}

/**
 * World integrity guard: runs once at module load so any future data edit
 * that breaks progression fails loudly instead of silently. Checks per Age:
 * unique ids, ordered non-empty ladders, and compositions that multiply out
 * to their configured combatPower using ONLY units the Age's manifest allows.
 */
function assertWorldIntegrity(): void {
  const seenAges = new Set<string>();
  const seenTargets = new Set<string>();

  for (const age of AGES) {
    if (seenAges.has(age.id)) {
      console.error(`Duplicate Age id "${age.id}".`);
    }
    seenAges.add(age.id);

    if (!Array.isArray(age.targets) || age.targets.length === 0) {
      console.error(`Age "${age.id}" defines no targets.`);
      continue;
    }

    let previousPower = 0;
    age.targets.forEach((target, index) => {
      if (seenTargets.has(target.id)) {
        console.error(`Duplicate target id "${target.id}" (Age "${age.id}").`);
      }
      seenTargets.add(target.id);

      if (target.order !== index + 1) {
        console.error(`Target "${target.id}" has order ${target.order}, expected ${index + 1}.`);
      }
      if (target.combatPower <= previousPower) {
        console.error(
          `Target "${target.id}" (${target.combatPower}) does not exceed the previous target (${previousPower}).`,
        );
      }
      previousPower = target.combatPower;

      let sum = 0;
      for (const entry of target.army) {
        const def: EnemyUnitDefinition | null = getEnemyUnit(entry.unitId);
        if (def === null) {
          console.error(`Target "${target.id}" references unknown enemy unit "${entry.unitId}".`);
          continue;
        }
        if (!age.enemyUnits.includes(entry.unitId)) {
          console.error(
            `Target "${target.id}" uses unit "${entry.unitId}" which is not in Age "${age.id}" pool.`,
          );
        }
        sum += def.combatPower * entry.quantity;
      }
      if (sum !== target.combatPower) {
        console.error(
          `Target "${target.id}" army sums to ${sum} CP but combatPower says ${target.combatPower}.`,
        );
      }

      if (!(target.heroChance >= 0 && target.heroChance <= 1)) {
        console.error(`Target "${target.id}" has out-of-range heroChance ${target.heroChance}.`);
      }
    });
  }
}

assertWorldIntegrity();

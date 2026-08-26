import type { CombatAbilityDefinition } from './abilities';
import { ABILITY_TIERS } from './abilities';

/**
 * Hero Skills — combat abilities assigned to enemy Heroes by class.
 *
 * Each of the four hidden hero classes (caster, ranged, support, tank) has
 * its own loadout. Spirit Devastator and Meteor Storm are once-per-battle
 * Very High tier ultimates; the rest range from basic to high tier and
 * repeat throughout combat. Availability is governed entirely by each
 * skill's conditions and cooldown — the unit factory attaches the relevant
 * ids via the hero class definitions.
 */

// ---------------------------------------------------------------------------
// Skill IDs
// ---------------------------------------------------------------------------

export const HERO_SKILL_IDS = {
  spiritDevastator: 'spirit-devastator',
  meteorStorm: 'meteor-storm',
  chainLightning: 'chain-lightning',
  fireball: 'fireball',
  rapidFire: 'rapid-fire',
  projectileRain: 'projectile-rain',
  shieldOfProtection: 'shield-of-protection',
  phoenixDown: 'phoenix-down',
  whirlwindSlash: 'whirlwind-slash',
  shieldBash: 'shield-bash',
} as const;

// ---------------------------------------------------------------------------
// Meteor Storm age gate
// ---------------------------------------------------------------------------

/** Ages where Meteor Storm remains thematically appropriate. */
const METEOR_STORM_AGES: readonly string[] = [
  'age-of-ash',
  'age-of-iron',
  'age-of-kings',
  'age-of-empires',
  'age-of-castles',
];

// ---------------------------------------------------------------------------
// Caster Skills
// ---------------------------------------------------------------------------

export const SPIRIT_DEVASTATOR: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.spiritDevastator,
  name: 'Spirit Devastator',
  description:
    'A Very High tier anti-Wraith devastation: erases a percentage of every Wraith on the field.',
  tier: ABILITY_TIERS.veryHigh,
  trigger: { kind: 'always' },
  conditions: [{ kind: 'min-units', side: 'attacker', unitId: 'wraith', count: 50 }],
  scalingChance: {
    side: 'attacker',
    unitId: 'wraith',
    baseChance: 0.02,
    thresholdUnits: 1_000_000,
    intervalUnits: 1_000_000,
    chancePerInterval: 0.03,
    maxChance: 0.35,
  },
  cooldownTicks: 20,
  durationTicks: null,
  oncePerBattle: true,
  weight: 3,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    percent: 0.2,
    filter: [{ unitId: 'wraith', noun: 'Wraiths' }],
  },
  activationLines: [
    '{commander} unleashes the spirit devastator — the wraiths scream as it descends.',
    'A cold wind reverses: {commander} has sent the devastator for its own.',
    '{commander} raises a hand, and every wraith on the field freezes mid-stride.',
  ],
  effectLines: [],
};

export const METEOR_STORM: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.meteorStorm,
  name: 'Meteor Storm',
  description:
    'A Very High tier apocalypse: rain kills unarmored troops outright, capped per casting.',
  tier: ABILITY_TIERS.veryHigh,
  trigger: { kind: 'always' },
  conditions: [
    { kind: 'stage-last' },
    { kind: 'age-in', ageIds: METEOR_STORM_AGES },
    { kind: 'min-units', side: 'attacker', count: 1, excludeTag: 'armored' },
  ],
  cooldownTicks: 20,
  durationTicks: null,
  oncePerBattle: true,
  weight: 3,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    percent: 0.3,
    cap: 1_080_000,
    filter: [{ excludeTag: 'armored', noun: 'units' }],
  },
  activationLines: [
    '{commander} splits the sky open — burning stones fall on the unarmored ranks.',
    '{commander} calls down fire, and armor alone holds back the rain.',
    'At {commander}\u2019s word, the heavens themselves join the defense.',
  ],
  effectLines: [],
};

export const CHAIN_LIGHTNING: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.chainLightning,
  name: 'Chain Lightning',
  description:
    'A mid tier arcing strike: forked bolts hunt spirit and flesh, searing hundreds where they stand.',
  tier: ABILITY_TIERS.advanced,
  trigger: { kind: 'always' },
  cooldownTicks: 15,
  durationTicks: null,
  weight: 2,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    mode: 'flat',
    range: { min: 500, max: 1000 },
    filterMode: 'any',
    filter: [{ tag: 'spirit' }, { tag: 'flesh' }],
    reportTemplate: '{count} bodies convulse and drop.',
  },
  activationLines: [
    '{commander} summons chain lightning — arcs leap from corpse to corpse.',
    'Forked bolts leap from {commander}\u2019s hand, hunting spirit and flesh.',
    '{commander} calls the storm\u2019s anger; lightning chains through your ranks.',
  ],
  effectLines: ['Spirit and flesh sear.'],
};

export const FIREBALL: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.fireball,
  name: 'Fireball',
  description:
    'A basic tier conflagration: a roaring fireball sweeps through the attacker\u2019s ranks.',
  tier: ABILITY_TIERS.basic,
  trigger: { kind: 'always' },
  cooldownTicks: 8,
  durationTicks: null,
  weight: 1,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    mode: 'flat',
    range: { min: 200, max: 500 },
    filterMode: 'any',
    filter: [{ tag: 'flesh', noun: 'units' }],
    reportTemplate: '{count} units burn in the conflagration.',
  },
  activationLines: [
    '{commander} hurls a fireball into the ranks — screams rise with the smoke.',
    'A sphere of flame leaps from {commander}\u2019s palm and detonates among your troops.',
    '{commander} ignites the air itself; fire rolls across the front line.',
  ],
  effectLines: ['Flames consume the ranks.'],
};

// ---------------------------------------------------------------------------
// Ranged Skills
// ---------------------------------------------------------------------------

export const RAPID_FIRE: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.rapidFire,
  name: 'Rapid Fire',
  description:
    'A high tier barrage that scythes through unarmored troops with relentless precision.',
  tier: ABILITY_TIERS.high,
  trigger: { kind: 'always' },
  conditions: [{ kind: 'min-units', side: 'attacker', count: 1 }],
  scalingChance: {
    side: 'attacker',
    baseChance: 0.05,
    thresholdUnits: 1000,
    intervalUnits: 1000,
    chancePerInterval: 0.02,
    maxChance: 0.25,
  },
  cooldownTicks: 10,
  durationTicks: null,
  weight: 2,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    percent: 0.15,
    cap: 14_800,
    capVariance: 0.08,
    // Scales with the player's deployed army (battle-start snapshot):
    // ×1000 troops above a threshold ⇒ ×1000 cap, so the barrage keeps
    // mattering into the idle-game endgame. Variance still applies.
    scalingCap: [
      { minUnits: 1e12, cap: 5e10 }, // 1T+ troops → ~50B
      { minUnits: 1e9, cap: 5e7 }, // 1B+ troops → ~50M
    ],
    filter: [{ excludeTag: 'armored', noun: 'troops' }],
    reportTemplate: 'A hail of projectiles cuts down {count} troops.',
  },
  activationLines: [
    '{commander} signals the volley — a wall of arrows darkens the sky.',
    'Bowstrings sing as {commander} unleashes a relentless storm of projectiles.',
    'Every arrow finds its mark: {commander} rains death upon the exposed ranks.',
  ],
  effectLines: [],
};

export const PROJECTILE_RAIN: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.projectileRain,
  name: 'Projectile Rain',
  description:
    'An advanced tier downpour of bolts that cuts down both flesh and spirit indiscriminately.',
  tier: ABILITY_TIERS.advanced,
  trigger: { kind: 'always' },
  cooldownTicks: 12,
  durationTicks: null,
  weight: 1,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    mode: 'flat',
    range: { min: 300, max: 800 },
    filterMode: 'any',
    filter: [{ tag: 'spirit' }, { tag: 'flesh' }],
    reportTemplate: '{count} units fall to the barrage.',
  },
  activationLines: [
    '{commander} calls the barrage — bolts fall like monsoon rain.',
    'Iron-tipped death pours from the sky at {commander}\u2019s command.',
    '{commander} opens the armory of the heavens; bolts fill the air from horizon to horizon.',
  ],
  effectLines: ['Bolts rain from above.'],
};

// ---------------------------------------------------------------------------
// Support Skills
// ---------------------------------------------------------------------------

export const SHIELD_OF_PROTECTION: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.shieldOfProtection,
  name: 'Shield of Protection',
  description:
    'A high tier defensive ward that bolsters all defenders when the hero\u2019s forces grow thin.',
  tier: ABILITY_TIERS.high,
  trigger: { kind: 'strength-below', side: 'own', fraction: 0.6 },
  cooldownTicks: 20,
  durationTicks: 15,
  weight: 2,
  effect: {
    kind: 'side-power',
    side: 'defender',
    multiplier: 1.5,
  },
  activationLines: [
    '{commander} raises the shield of protection — a shimmering ward settles over the defenders.',
    'Light converges on {commander}\u2019s banner; a dome of protective magic envelops your allies.',
    '{commander} speaks the old words, and an ancient ward awakens to shield the ranks.',
  ],
  effectLines: ['A protective ward settles over the defenders.'],
};

export const PHOENIX_DOWN: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.phoenixDown,
  name: 'Phoenix Down',
  description:
    'A very high tier once-per-battle miracle: a fallen hero is restored to the battlefield by phoenix fire.',
  tier: ABILITY_TIERS.veryHigh,
  trigger: { kind: 'always' },
  conditions: [{ kind: 'fallen-heroes-exist' }],
  cooldownTicks: 30,
  durationTicks: null,
  oncePerBattle: true,
  weight: 3,
  effect: {
    kind: 'hero-revive',
  },
  activationLines: [
    '{commander} presses the phoenix down to a fallen ally — fire wreathes their broken form.',
    'A feather of flame descends from {commander}\u2019s hand; the dead hero stirs and rises.',
    '{commander} invokes the phoenix rite — golden fire erupts where a hero fell.',
  ],
  effectLines: ['A hero is restored to the battlefield.'],
};

// ---------------------------------------------------------------------------
// Tank Skills
// ---------------------------------------------------------------------------

export const WHIRLWIND_SLASH: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.whirlwindSlash,
  name: 'Whirlwind Slash',
  description:
    'An advanced tier spinning strike that cleaves through nearby enemies in a wide arc.',
  tier: ABILITY_TIERS.advanced,
  trigger: { kind: 'always' },
  cooldownTicks: 8,
  durationTicks: null,
  weight: 1,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    mode: 'flat',
    range: { min: 100, max: 600 },
    filterMode: 'any',
    filter: [{ tag: 'flesh' }, { tag: 'spirit' }],
    reportTemplate: '{count} enemies are cleaved by the whirlwind.',
  },
  activationLines: [
    '{commander} spins into the fray — steel whirls in a deadly arc that tears through the front line.',
    'A ring of steel erupts from {commander}\u2019s blade; enemies crumble in every direction.',
    '{commander} unleashes the whirlwind — nowhere is safe within reach of that blade.',
  ],
  effectLines: ['Steel whirls in a deadly arc.'],
};

export const SHIELD_BASH: CombatAbilityDefinition = {
  id: HERO_SKILL_IDS.shieldBash,
  name: 'Shield Bash',
  description:
    'A basic tier frontal assault that shatters armored targets with brutal concussive force.',
  tier: ABILITY_TIERS.basic,
  trigger: { kind: 'always' },
  conditions: [{ kind: 'min-units', side: 'attacker', count: 1, tag: 'armored' }],
  cooldownTicks: 6,
  durationTicks: null,
  weight: 1,
  effect: {
    kind: 'casualties',
    side: 'attacker',
    mode: 'flat',
    range: { min: 50, max: 200 },
    filter: [{ tag: 'armored', noun: 'armored units' }],
    reportTemplate: '{count} armored units are shattered.',
  },
  activationLines: [
    '{commander} slams the shield forward — iron buckles and armor cracks on impact.',
    'A deafening crack rings out as {commander}\u2019s shield meets the armored vanguard.',
    '{commander} drives the shield into the formation; plate warps and bodies fly.',
  ],
  effectLines: ['Armor rings under the impact.'],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Registry of all Hero Skills keyed by their stable id. */
export const HERO_SKILLS: Readonly<Record<string, CombatAbilityDefinition>> = {
  [HERO_SKILL_IDS.spiritDevastator]: SPIRIT_DEVASTATOR,
  [HERO_SKILL_IDS.meteorStorm]: METEOR_STORM,
  [HERO_SKILL_IDS.chainLightning]: CHAIN_LIGHTNING,
  [HERO_SKILL_IDS.fireball]: FIREBALL,
  [HERO_SKILL_IDS.rapidFire]: RAPID_FIRE,
  [HERO_SKILL_IDS.projectileRain]: PROJECTILE_RAIN,
  [HERO_SKILL_IDS.shieldOfProtection]: SHIELD_OF_PROTECTION,
  [HERO_SKILL_IDS.phoenixDown]: PHOENIX_DOWN,
  [HERO_SKILL_IDS.whirlwindSlash]: WHIRLWIND_SLASH,
  [HERO_SKILL_IDS.shieldBash]: SHIELD_BASH,
};

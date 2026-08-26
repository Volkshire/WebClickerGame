import { describe, expect, it } from 'vitest';
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import type { BattleSimulationOptions } from '../src/systems/combat/simulation';
import type { BattleTargetMeta } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';
import { createHeroForTarget } from '../src/systems/combat/enemyUnits';
import {
  HERO_SKILLS,
  SPIRIT_DEVASTATOR,
  METEOR_STORM,
  CHAIN_LIGHTNING,
  RAPID_FIRE,
} from '../src/systems/combat/heroSkills';
import { ABILITY_TIERS } from '../src/systems/combat/abilities';
import type { CombatAbilityDefinition } from '../src/systems/combat/abilities';
import { formatExact } from '../src/systems/combat/battleFlavor';
import { mulberry } from './helpers';

/**
 * Very High tier Hero Skills end to end: Spirit Devastator (anti-Wraith,
 * chance-scaled) and Meteor Storm (anti-unarmored, capped, era/stage gated),
 * plus once-per-battle lifecycle and safety properties in live simulations.
 */

const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;

function wraiths(count: number): BattleGroupInput {
  return {
    unitId: 'wraith',
    name: 'Wraiths',
    count,
    combatPowerEach: 1,
    type: 'melee',
    tags: ['spirit'],
  };
}

function skeletons(count: number): BattleGroupInput {
  return {
    unitId: 'skeleton',
    name: 'Skeletons',
    count,
    combatPowerEach: 2,
    type: 'ranged',
    tags: ['bone'],
  };
}

function zombies(count: number): BattleGroupInput {
  return {
    unitId: 'zombie',
    name: 'Zombies',
    count,
    combatPowerEach: 6,
    type: 'melee',
    tags: ['flesh'],
  };
}

function armored(count: number): BattleGroupInput {
  return {
    unitId: 'death_knight',
    name: 'Death Knights',
    count,
    combatPowerEach: 75,
    type: 'melee',
    tags: ['armored'],
  };
}

/** Enemy Hero carrying the shipped skill loadout, threat disabled for math isolation. */
function hero(): BattleGroupInput {
  const def = createHeroForTarget({ combatPower: 1000, order: 5 }, 'Aldric');
  // Definition shape (id/combatPower) -> battle-input shape (unitId/combatPowerEach),
  // mirroring enemyGroupToInput in CombatSystem.
  return {
    unitId: def.id,
    name: def.name,
    count: 1,
    combatPowerEach: def.combatPower,
    type: def.type,
    tags: def.tags,
    isHero: true,
    resolve: def.resolve,
    tactics: ['spirit-devastator', 'meteor-storm', 'chain-lightning'],
  };
}

function meta(over: Partial<BattleTargetMeta> = {}): BattleTargetMeta {
  return { id: 'x', name: 'X', terrain: 'plains', ...over };
}

function guaranteed(clone: CombatAbilityDefinition): CombatAbilityDefinition {
  return {
    ...clone,
    ...(clone.scalingChance
      ? {
          // Force a certain roll WITHOUT tripping the curve's own ceiling.
          scalingChance: { ...clone.scalingChance, baseChance: 1, maxChance: 1 },
        }
      : {}),
  };
}

interface ObservedRun {
  tacticEvents: { message: string; tier?: string }[];
  forcesByTick: { wraiths: number[]; skeletons: number[]; knights: number[] };
  final: ReturnType<BattleSimulation['snapshot']>;
}

function observe(
  seed: number,
  attackers: BattleGroupInput[],
  defenders: BattleGroupInput[],
  battleMeta: BattleTargetMeta,
  registry: Record<string, CombatAbilityDefinition>,
): ObservedRun {
  const sim = new BattleSimulation(
    battleMeta,
    attackers.map((g) => ({ ...g })),
    defenders.map((g) => ({ ...g })),
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(seed), abilityRegistry: registry },
  );
  const seen = new Set<number>();
  const tacticEvents: { message: string; tier?: string }[] = [];
  const forcesByTick = {
    wraiths: [] as number[],
    zombies: [] as number[],
    skeletons: [] as number[],
    knights: [] as number[],
  };
  let ticks = 0;
  while (!sim.complete && ticks < 100000) {
    sim.advance(interval);
    ticks += 1;
    const snap = sim.snapshot();
    const find = (name: string) => snap.attackerForces.find((f) => f.name === name)?.surviving ?? 0;
    forcesByTick.wraiths.push(find('Wraiths'));
    forcesByTick.zombies.push(find('Zombies'));
    forcesByTick.skeletons.push(find('Skeletons'));
    forcesByTick.knights.push(find('Death Knights'));
    for (const event of snap.events) {
      if (event.kind === 'tactic' && !seen.has(event.id)) {
        seen.add(event.id);
        tacticEvents.push({ message: event.message, tier: event.tier });
      }
    }
  }
  return { tacticEvents, forcesByTick, final: sim.snapshot() };
}

function control(
  seed: number,
  attackers: BattleGroupInput[],
  defenders: BattleGroupInput[],
  battleMeta: BattleTargetMeta,
): ObservedRun {
  return observe(seed, attackers, defenders, battleMeta, {});
}

describe('skill data & attachment', () => {
  it('ultimates are Very High tier; Chain Lightning is mid tier', () => {
    expect(SPIRIT_DEVASTATOR.tier).toBe(ABILITY_TIERS.veryHigh);
    expect(METEOR_STORM.tier).toBe(ABILITY_TIERS.veryHigh);
    expect(CHAIN_LIGHTNING.tier).toBe(ABILITY_TIERS.advanced);
    expect(HERO_SKILLS['spirit-devastator']).toBeDefined();
    expect(HERO_SKILLS['meteor-storm']).toBeDefined();
    expect(HERO_SKILLS['chain-lightning']).toBeDefined();
  });

  it('every spawned Hero carries the full skill loadout', () => {
    const heroDef = createHeroForTarget({ combatPower: 5000, order: 7 }, 'Test');
    expect(heroDef.tactics).toContain('spirit-devastator');
    expect(heroDef.tactics).toContain('meteor-storm');
    expect(heroDef.tactics).toContain('chain-lightning');
  });
});

describe('Spirit Devastator', () => {
  const attackers = [wraiths(1000), skeletons(400)];
  const defenders = [hero()];
  const midAge = meta({ ageId: 'age-of-ash', order: 5, totalTargets: 10 });

  it('removes exactly 20% of current Wraiths, reports the real number, once', () => {
    const run = observe(9001, attackers, defenders, midAge, {
      'spirit-devastator': guaranteed(SPIRIT_DEVASTATOR),
    });
    const ctrl = control(9001, attackers, defenders, midAge);

    // Presentation: dramatic three-line beat with the exact body count.
    expect(run.tacticEvents.some((e) => e.message.includes('USES') && e.message.includes('SPIRIT DEVASTATOR')) ||
      run.tacticEvents.some((e) => e.message === 'SPIRIT DEVASTATOR')).toBe(true);

    // Mechanics: first-tick delta vs identical-seed control is exactly 20%
    // of the CURRENT (post-attrition) Wraith count at the activation moment.
    expect(ctrl.forcesByTick.wraiths[0]).toBeGreaterThan(0);
    const delta = ctrl.forcesByTick.wraiths[0]! - run.forcesByTick.wraiths[0]!;
    const expectedKilled = Math.floor(ctrl.forcesByTick.wraiths[0]! * 0.2);
    expect(delta).toBe(expectedKilled);
    // The log states the real number removed.
    expect(run.tacticEvents).toContainEqual({
      message: `${formatExact(expectedKilled)} WRAITHS DESTROYED.`,
      tier: ABILITY_TIERS.veryHigh,
    });
    // Non-Wraith units are untouched by the effect itself.
    expect(run.forcesByTick.skeletons[0]).toBe(ctrl.forcesByTick.skeletons[0]);

    // Once-per-battle: exactly one casting no matter how long the fight runs.
    const castings = run.tacticEvents.filter((e) => e.message.includes('SPIRIT DEVASTATOR'));
    expect(castings.length).toBeGreaterThanOrEqual(1);
    const banners = run.tacticEvents.filter((e) => e.message === 'SPIRIT DEVASTATOR').length;
    expect(banners).toBe(1);
  });

  it('never activates below the 50-Wraith minimum', () => {
    const run = observe(9002, [wraiths(49)], defenders, midAge, {
      'spirit-devastator': guaranteed(SPIRIT_DEVASTATOR),
    });
    expect(run.tacticEvents).toHaveLength(0);
  });

  it('a failed chance roll consumes nothing; curve config gates activation', () => {
    // Zero base chance: condition passes but the probability gate blocks forever.
    const run = observe(9003, [wraiths(2_000_000)], defenders, midAge, {
      'spirit-devastator': {
        ...SPIRIT_DEVASTATOR,
        scalingChance: { ...SPIRIT_DEVASTATOR.scalingChance!, baseChance: 0 },
      },
    });
    expect(run.tacticEvents).toHaveLength(0);
  });
});

describe('Chain Lightning', () => {
  const midAge = meta({ ageId: 'age-of-ash', order: 5, totalTargets: 10 });
  const mixedArmy = [wraiths(20000), zombies(20000), skeletons(20000), armored(5000)];

  it('strikes a random 500-1,000 spirit/flesh bodies and reports them', () => {
    const run = observe(5555, mixedArmy, [hero()], midAge, {
      'chain-lightning': CHAIN_LIGHTNING,
    });
    const ctrl = control(5555, mixedArmy, [hero()], midAge);

    const report = run.tacticEvents.find((e) =>
      /bodies convulse and drop\.$/.test(e.message),
    );
    expect(report).toBeDefined();
    expect(report!.tier).toBe(ABILITY_TIERS.advanced);

    // The exact reported number sits inside the configured range.
    const killed = Number.parseInt(report!.message.replace(/,/g, ''), 10);
    expect(killed).toBeGreaterThanOrEqual(500);
    expect(killed).toBeLessThanOrEqual(1000);

    // Coverage: spirit (Wraiths) + flesh (Zombies) absorb exactly that many
    // bodies; bone and armored stacks are untouched by the strike itself.
    const wraithDelta = ctrl.forcesByTick.wraiths[0]! - run.forcesByTick.wraiths[0]!;
    const zombieDelta = ctrl.forcesByTick.zombies[0]! - run.forcesByTick.zombies[0]!;
    expect(wraithDelta).toBeGreaterThanOrEqual(0);
    expect(zombieDelta).toBeGreaterThanOrEqual(0);
    expect(wraithDelta + zombieDelta).toBe(killed);
    expect(ctrl.forcesByTick.skeletons[0]).toBe(run.forcesByTick.skeletons[0]);
    expect(ctrl.forcesByTick.knights[0]).toBe(run.forcesByTick.knights[0]);

    // The caster is woven into the flavor line (natural case on mid tier).
    expect(run.tacticEvents[0].message).toContain('Aldric');
  });

  it('never fires when no spirit or flesh units exist', () => {
    const run = observe(5556, [skeletons(30000), armored(5000)], [hero()], midAge, {
      'chain-lightning': CHAIN_LIGHTNING,
    });
    expect(run.tacticEvents).toHaveLength(0);
  });
});

describe('once-per-battle lifecycle', () => {
  it('resets when a completely new battle begins', () => {
    const attackers = [wraiths(1000)];
    const defenders = [hero()];
    const battleMeta = meta({ ageId: 'age-of-ash', order: 5, totalTargets: 10 });
    const registry = { 'spirit-devastator': guaranteed(SPIRIT_DEVASTATOR) };

    const battleOne = observe(11, attackers, defenders, battleMeta, registry);
    const battleTwo = observe(11, attackers, defenders, battleMeta, registry);

    const castingsOne = battleOne.tacticEvents.filter((e) => e.message === 'SPIRIT DEVASTATOR');
    const castingsTwo = battleTwo.tacticEvents.filter((e) => e.message === 'SPIRIT DEVASTATOR');
    expect(castingsOne.length).toBe(1);
    expect(castingsTwo.length).toBe(1);
  });
});

describe('Meteor Storm', () => {
  const attackers = [wraiths(2000), armored(1000)];
  const defenders = [hero()];
  const lastStageCastles = meta({
    ageId: 'age-of-castles',
    order: 10,
    totalTargets: 10,
  });

  it('kills 30% of NON-armored units on an Age-final stage and reports them', () => {
    const run = observe(7007, attackers, defenders, lastStageCastles, {
      'meteor-storm': METEOR_STORM,
    });
    const ctrl = control(7007, attackers, defenders, lastStageCastles);

    // 30% of the CURRENT unarmored count at the activation moment.
    const expectedKilled = Math.floor(ctrl.forcesByTick.wraiths[0]! * 0.3);
    expect(run.tacticEvents).toContainEqual({
      message: `${formatExact(expectedKilled)} UNITS DESTROYED.`,
      tier: ABILITY_TIERS.veryHigh,
    });
    // Armored ranks are completely excluded from the calculation.
    expect(run.forcesByTick.knights[0]).toBe(ctrl.forcesByTick.knights[0]);
    // Wraiths took exactly the 30% strike.
    expect(ctrl.forcesByTick.wraiths[0]! - run.forcesByTick.wraiths[0]!).toBe(expectedKilled);

    const banners = run.tacticEvents.filter((e) => e.message === 'METEOR STORM').length;
    expect(banners).toBe(1); // once-per-battle
  });

  it('is restricted to the LAST stage of an Age', () => {
    const run = observe(7008, attackers, defenders, meta({
      ageId: 'age-of-castles',
      order: 9,
      totalTargets: 10,
    }), { 'meteor-storm': METEOR_STORM });
    expect(run.tacticEvents).toHaveLength(0);
  });

  it('is unavailable in designated modern Ages (Gunpowder onward)', () => {
    for (const ageId of ['age-of-gunpowder', 'age-of-industry', 'age-of-machines', 'age-of-steel', 'age-of-ruin']) {
      const run = observe(7009, attackers, defenders, meta({
        ageId,
        order: 10,
        totalTargets: 10,
      }), { 'meteor-storm': METEOR_STORM });
      expect(run.tacticEvents, `${ageId} must block Meteor Storm`).toHaveLength(0);
    }
  });

  it('respects the configured absolute casualty cap in live combat', () => {
    const capped: CombatAbilityDefinition = { ...METEOR_STORM, effect: { ...METEOR_STORM.effect, cap: 5 } as typeof METEOR_STORM.effect };
    const run = observe(7010, attackers, defenders, lastStageCastles, {
      'meteor-storm': capped,
    });
    const ctrl = control(7010, attackers, defenders, lastStageCastles);
    expect(run.tacticEvents).toContainEqual({
      message: '5 UNITS DESTROYED.',
      tier: ABILITY_TIERS.veryHigh,
    });
    expect(ctrl.forcesByTick.wraiths[0]! - run.forcesByTick.wraiths[0]!).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Rapid Fire — attacker-size scaling cap tiers
// ---------------------------------------------------------------------------

describe('Rapid Fire scaling cap', () => {
  // Tactic beats are presented uppercase — match that, not the template.
  const REPORT = 'A HAIL OF PROJECTILES CUTS DOWN ';

  /** Enemy Hero carrying only the Ranged ultimate. */
  function rangedHero(): BattleGroupInput {
    const def = createHeroForTarget({ combatPower: 1000, order: 5 }, 'Bryce');
    return {
      unitId: def.id,
      name: def.name,
      count: 1,
      combatPowerEach: def.combatPower,
      type: def.type,
      tags: def.tags,
      isHero: true,
      resolve: def.resolve,
      tactics: ['rapid-fire'],
    };
  }

  const defenders = [rangedHero()];
  const midAge = meta({ ageId: 'age-of-ash', order: 5, totalTargets: 10 });

  /** Kill counts parsed from the skill's report lines (formatExact → commas). */
  function reportedKills(run: ObservedRun): number[] {
    return run.tacticEvents
      .filter((e) => e.message.startsWith(REPORT))
      .map((e) =>
        Number(
          e.message
            .slice(REPORT.length)
            .replace(/ TROOPS\.$/, '')
            .replace(/,/g, ''),
        ),
      )
      .filter((n) => Number.isFinite(n));
  }

  it('sub-billion armies stay on the ~15K baseline cap', () => {
    const run = observe(9101, [wraiths(10_000_000)], defenders, midAge, {
      'rapid-fire': guaranteed(RAPID_FIRE),
    });
    const kills = reportedKills(run);
    expect(kills.length).toBeGreaterThanOrEqual(1); // 15% of 10M ≫ cap → every cast clamps
    for (const killed of kills) {
      expect(killed).toBeLessThanOrEqual(Math.ceil(14_800 * 1.08));
    }
  });

  it('billion-strong armies unlock the ~50M tier', () => {
    const run = observe(9102, [wraiths(2_000_000_000)], defenders, midAge, {
      'rapid-fire': guaranteed(RAPID_FIRE),
    });
    const kills = reportedKills(run);
    // 15% of 2B = 300M raw ≫ tier cap → casts clamp into the variance band.
    expect(kills.length).toBeGreaterThanOrEqual(1);
    for (const killed of kills) {
      expect(killed).toBeGreaterThanOrEqual(46_000_000);
      expect(killed).toBeLessThanOrEqual(54_000_000);
    }
  });

  it('trillion-scale armies reach the ~50B tier', () => {
    const run = observe(9103, [wraiths(3_000_000_000_000)], defenders, midAge, {
      'rapid-fire': guaranteed(RAPID_FIRE),
    });
    const kills = reportedKills(run);
    expect(kills.length).toBeGreaterThanOrEqual(1);
    for (const killed of kills) {
      expect(killed).toBeGreaterThanOrEqual(46_000_000_000);
      expect(killed).toBeLessThanOrEqual(54_000_000_000);
    }
  });

  it('tier selection is deterministic for identical seeds', () => {
    const a = observe(9104, [wraiths(2_000_000_000)], defenders, midAge, {
      'rapid-fire': guaranteed(RAPID_FIRE),
    });
    const b = observe(9104, [wraiths(2_000_000_000)], defenders, midAge, {
      'rapid-fire': guaranteed(RAPID_FIRE),
    });
    expect(a.tacticEvents).toEqual(b.tacticEvents);
  });
});

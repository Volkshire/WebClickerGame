import { beforeEach, describe, expect, it } from 'vitest';
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput, BattleSimulationOptions } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING, ZOMBIE_PLAGUE_ENEMY_SHARE_CAP } from '../src/systems/combat/pacing';
import { ashGarrison, mulberry } from './helpers';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

const SEED = 20260825;

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

function wraithSwarm(count = 600): BattleGroupInput {
  return {
    unitId: 'wraith',
    name: 'Wraiths',
    count,
    combatPowerEach: 1,
    type: 'melee',
    tags: ['spirit'],
  };
}

/** Runs a fully deterministic battle against the Ash garrison. */
function run(
  seed: number,
  attackers: BattleGroupInput[],
  options: BattleSimulationOptions = {},
) {
  const sim = new BattleSimulation(
    { id: 'baseline', name: 'Baseline', terrain: 'plains' },
    attackers.map((group) => ({ ...group })),
    ashGarrison().map((group) => ({ ...group })),
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(seed), ...options },
  );
  const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
  let guard = 0;
  while (!sim.complete && guard < 100000) {
    sim.advance(interval);
    guard += 1;
  }
  const snapshot = sim.snapshot();
  return {
    outcome: snapshot.outcome,
    forces: snapshot.attackerForces,
    defenderCasualties: snapshot.defenderCasualties,
    events: snapshot.events.map((event) => event.message),
    survivors: sim.survivingArmy(),
  };
}

const zombieForceOf = (result: ReturnType<typeof run>) =>
  result.forces.find((force) => force.unitId === 'zombie');

describe('Zombie Plague', () => {
  it('is fully inert when the research is not owned', () => {
    const baseline = run(SEED, [wraithSwarm()]);
    const flagOff = run(SEED, [wraithSwarm()], { zombiePlague: false });
    expect(flagOff).toEqual(baseline);
  });

  it('does nothing without zombies on the field', () => {
    const baseline = run(SEED, [wraithSwarm()]);
    const noCarriers = run(SEED, [wraithSwarm()], { zombiePlague: true });

    expect(noCarriers.forces.some((force) => force.unitId === 'zombie')).toBe(false);
    expect(noCarriers).toEqual(baseline);
  });

  it('spawns zombies mid-battle that survive back to the garrison', () => {
    const result = run(SEED, [wraithSwarm(), zombies(40)], { zombiePlague: true });

    expect(result.outcome).toBe('victory');

    const force = zombieForceOf(result);
    expect(force).toBeDefined();
    // Reinforcements were merged into the stack: deployed exceeds input.
    expect((force?.deployed ?? 0)).toBeGreaterThan(40);

    // Survivors (spawned ones included) march home.
    const survivorGroup = result.survivors.find((group) => group.unitId === 'zombie');
    expect(survivorGroup?.count ?? 0).toBeGreaterThan(0);

    // The rising is announced exactly once per battle (any plague line).
    const PLAGUE_PHRASES = ['stagger back up', 'rise to fill the horde', "march again, on the wrong side"];
    const lines = result.events.filter((message) =>
      PLAGUE_PHRASES.some((phrase) => message.includes(phrase)),
    );
    expect(lines.length).toBe(1);
  });

  it('never converts more than 25% of the enemy garrison per battle', () => {
    const enemyTotal = ashGarrison().reduce((sum, group) => sum + group.count, 0);
    const budget = Math.floor(enemyTotal * ZOMBIE_PLAGUE_ENEMY_SHARE_CAP);
    expect(budget).toBeGreaterThan(0);

    // Overkill horde: the garrison falls fast while the plague procs hard.
    const result = run(SEED, [wraithSwarm(), zombies(400)], { zombiePlague: true });

    const force = zombieForceOf(result);
    expect(force).toBeDefined();
    const spawned = (force?.deployed ?? 0) - 400;
    expect(spawned).toBeGreaterThanOrEqual(1);
    expect(spawned).toBeLessThanOrEqual(budget);
  });

  it('is deterministic for identical seeds and options', () => {
    const a = run(SEED + 7, [wraithSwarm(), zombies(30)], { zombiePlague: true });
    const b = run(SEED + 7, [wraithSwarm(), zombies(30)], { zombiePlague: true });
    expect(a).toEqual(b);
  });

  // ------------------------------------------------------------------
  // Plague flavor beats: initial rising / recurring raises / cap hit
  // ------------------------------------------------------------------

  const RISING_PHRASES = ['stagger back up', 'rise to fill the horde', "march again, on the wrong side"];
  const RAISE_PHRASES = [
    'stitch fresh soldiers',
    'now fights itself',
    'Corpses are currency',
    'trade their banners',
    'Every kill is a recruitment',
  ];
  const CAP_PHRASES = [
    'A quarter of their army',
    'harvest is complete',
    'full tithe',
    'One soldier in four',
  ];
  const countPhrases = (events: string[], phrases: string[]) =>
    events.filter((message) => phrases.some((phrase) => message.includes(phrase))).length;

  it('announces the initial rising once and never repeats it', () => {
    const result = run(SEED, [wraithSwarm(), zombies(400)], { zombiePlague: true });
    expect(countPhrases(result.events, RISING_PHRASES)).toBe(1);
  });

  it('fires replenishment beats as ranks are refilled from corpses', () => {
    const result = run(SEED, [wraithSwarm(), zombies(400)], { zombiePlague: true });
    const force = zombieForceOf(result)!;
    const spawned = force.deployed - 400;
    // Plenty of conversions implies multiple spawn ticks — the every-5th
    // cadence guarantees at least one replenishment beat.
    if (spawned >= 25) {
      expect(countPhrases(result.events, RAISE_PHRASES)).toBeGreaterThanOrEqual(1);
    }
  });

  it('fires the conversion-cap beat exactly once when the budget empties', () => {
    // Scan seeds for a run where the plague fully consumes its quarter share.
    let checked = false;
    for (let offset = 0; offset < 25; offset += 1) {
      const result = run(SEED + offset * 11, [wraithSwarm(), zombies(600)], {
        zombiePlague: true,
      });
      const enemyTotal = ashGarrison().reduce((sum, group) => sum + group.count, 0);
      const budget = Math.floor(enemyTotal * ZOMBIE_PLAGUE_ENEMY_SHARE_CAP);
      const spawned = (zombieForceOf(result)?.deployed ?? 600) - 600;

      expect(countPhrases(result.events, RISING_PHRASES)).toBeLessThanOrEqual(1);
      expect(countPhrases(result.events, CAP_PHRASES)).toBeLessThanOrEqual(1);

      if (spawned >= budget) {
        checked = true;
        // Budget exhausted → the tithe beat MUST have landed, exactly once.
        expect(countPhrases(result.events, CAP_PHRASES)).toBe(1);
      }
    }
    expect(checked).toBe(true);
  });
});

import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput, BattleSimulationOptions } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';
import type { BattleSnapshot } from '../src/systems/combat/simulation';

/** Deterministic RNG matching scripts/smoke-hero-tuning.ts so seeds behave identically. */
export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  };
}

export interface CompletedBattle {
  outcome: string | null;
  elapsedSeconds: number;
  attackerCasualties: number;
  defenderCasualties: number;
  attackerSurvivors: { name: string; surviving: number }[];
  defenderSurvivors: { name: string; surviving: number }[];
  events: { id: number; kind: string; message: string }[];
  fledHeroes: string[];
}

function summarize(snapshot: BattleSimulation, fled: string[]): CompletedBattle {
  const s: BattleSnapshot = snapshot.snapshot();
  return {
    outcome: s.outcome,
    elapsedSeconds: s.elapsedSeconds,
    attackerCasualties: s.attackerCasualties,
    defenderCasualties: s.defenderCasualties,
    attackerSurvivors: s.attackerForces.map((f) => ({ name: f.name, surviving: f.surviving })),
    defenderSurvivors: s.defenderForces.map((f) => ({ name: f.name, surviving: f.surviving })),
    events: s.events.map((e) => ({ id: e.id, kind: e.kind, message: e.message })),
    fledHeroes: [...fled],
  };
}

/**
 * Runs a battle to completion one tick at a time (same pumping pattern as
 * the live game loop and scripts/smoke-hero-tuning.ts).
 */
export function runBattle(
  seed: number,
  attackers: BattleGroupInput[],
  defenders: BattleGroupInput[],
  options: BattleSimulationOptions = {},
): CompletedBattle {
  const sim = new BattleSimulation(
    { id: 'baseline', name: 'Baseline', terrain: 'plains' },
    attackers.map((g) => ({ ...g })),
    defenders.map((g) => ({ ...g })),
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(seed), ...options },
  );
  const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;
  let guard = 0;
  while (!sim.complete && guard < 100000) {
    sim.advance(interval);
    guard += 1;
  }
  return summarize(sim, sim.getFledHeroNames());
}

/** Player-side chaff stack (Wraith-shaped). */
export function wraiths(count: number): BattleGroupInput {
  return {
    unitId: 'wraith',
    name: 'Wraiths',
    count,
    combatPowerEach: 1,
    type: 'melee',
    tags: ['spirit'],
  };
}

/** Enemy recruit-band stacks shaped like an Age-of-Ash garrison. */
export function ashGarrison(): BattleGroupInput[] {
  return [
    { unitId: 'recruit-melee', name: 'Recruit Melee', count: 30, combatPowerEach: 1, type: 'melee' },
    { unitId: 'recruit-ranged', name: 'Recruit Ranged', count: 20, combatPowerEach: 1, type: 'ranged' },
    { unitId: 'trained-melee', name: 'Trained Melee', count: 5, combatPowerEach: 3, type: 'melee' },
  ];
}

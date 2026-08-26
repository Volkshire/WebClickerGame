import { describe, expect, it } from 'vitest';
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import type { BattleSimulationOptions } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';
import { ENEMY_UNITS } from '../src/systems/combat/enemyUnits';
import { COMBAT_TACTICS, TACTIC_IDS, VOLLEY_FIRE } from '../src/systems/combat/tactics';
import { formatExact } from '../src/systems/combat/battleFlavor';
import { ashGarrison, mulberry, runBattle, wraiths } from './helpers';

/**
 * Commander Tactics end to end: ownership, real triggers inside a live
 * BattleSimulation, mechanical effect direction/magnitude, duration,
 * cooldown, and battle-log integration.
 *
 * Scenario math notes: stacks lose AT LEAST 1 body per combat tick
 * (engine floor), so tiny officer stacks die before any trigger can fire —
 * scenarios use garrison-sized commander bands. The casualty clamp (max
 * 11%/tick) only applies to the OUTGUNNED side, so Press the Assault's
 * defender-power boost stays visible by keeping the pre-press power ratio
 * under ~0.49 (post-boost fraction remains sub-clamp).
 */

const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;

function commanderStack(count: number, tactics: readonly string[]): BattleGroupInput {
  return {
    unitId: 'commander',
    name: 'Commander',
    count,
    combatPowerEach: 150,
    type: 'melee',
    tags: ['armored'],
    tactics: [...tactics],
  };
}

/** Runs a battle tick by tick, collecting tactic events and power history. */
function runObserved(
  seed: number,
  attackers: BattleGroupInput[],
  defenders: BattleGroupInput[],
  options: BattleSimulationOptions = {},
) {
  const sim = new BattleSimulation(
    { id: 'observed', name: 'Observed', terrain: 'plains' },
    attackers.map((g) => ({ ...g })),
    defenders.map((g) => ({ ...g })),
    DEFAULT_BATTLE_PACING,
    { rng: mulberry(seed), ...options },
  );
  const seen = new Set<number>();
  const tacticEvents: { tick: number; message: string }[] = [];
  const defenderPowers: number[] = [];
  const attackerPowers: number[] = [];
  const defenderCasualtiesPerTick: number[] = [];
  let ticks = 0;
  while (!sim.complete && ticks < 100000) {
    sim.advance(interval);
    ticks += 1;
    const snap = sim.snapshot();
    defenderPowers.push(snap.defenderPower);
    attackerPowers.push(snap.attackerPower);
    defenderCasualtiesPerTick.push(snap.defenderCasualties);
    for (const event of snap.events) {
      if (event.kind === 'tactic' && !seen.has(event.id)) {
        seen.add(event.id);
        tacticEvents.push({ tick: ticks, message: event.message });
      }
    }
  }
  return {
    sim,
    ticks,
    tacticEvents,
    defenderPowers,
    attackerPowers,
    defenderCasualtiesPerTick,
    final: sim.snapshot(),
  };
}

describe('tactic ownership', () => {
  it('every commander-tier unit owns the shipped tactics', () => {
    for (const unit of Object.values(ENEMY_UNITS)) {
      if (unit.tier !== 'commander') continue;
      expect(unit.tactics, `${unit.id} should own tactics`).toEqual([
        TACTIC_IDS.pressTheAssault,
        TACTIC_IDS.rally,
        TACTIC_IDS.volleyFire,
      ]);
    }
  });

  it('non-commander units never own tactics', () => {
    for (const unit of Object.values(ENEMY_UNITS)) {
      if (unit.tier === 'commander') continue;
      expect(unit.tactics, `${unit.id} should be tactic-free`).toBeUndefined();
    }
  });

  it('shipped registry resolves both tactic ids', () => {
    expect(COMBAT_TACTICS[TACTIC_IDS.pressTheAssault]?.name).toBe('Press the Assault');
    expect(COMBAT_TACTICS[TACTIC_IDS.rally]?.name).toBe('Rally');
  });
});

describe('Press the Assault in live combat', () => {
  // Player horde holds the power advantage (so its losses stay unclamped
  // and the x1.25 enemy boost is measurable) but its HEADCOUNT bleeds past
  // the 60% threshold while a garrison-sized commander band survives.
  const PRESS = [TACTIC_IDS.pressTheAssault] as const;
  const attackers = [wraiths(10000)];
  const defenders = [commanderStack(24, PRESS)];

  it('triggers from the enemy-faltering condition with flavor then announcement', () => {
    const run = runObserved(777, attackers, defenders);
    const announcements = run.tacticEvents.filter((e) =>
      e.message.includes('USES PRESS THE ASSAULT'),
    );
    expect(announcements.length).toBeGreaterThanOrEqual(1);
    // Cooldown (duration 5 + cooldown 12) gates repeat activations.
    for (let i = 1; i < announcements.length; i++) {
      expect(announcements[i].tick - announcements[i - 1].tick).toBeGreaterThanOrEqual(17);
    }
    // The announcement carries the natural-language mechanical effect...
    expect(announcements[0].message).toBe(
      'COMMANDER USES PRESS THE ASSAULT — Enemy damage increased.',
    );
    // ...and a flavor line about this commander immediately precedes it.
    const index = run.tacticEvents.indexOf(announcements[0]);
    expect(index).toBeGreaterThanOrEqual(1);
    const flavor = run.tacticEvents[index - 1];
    expect(flavor.message).toContain('Commander');
    expect(flavor.message).not.toContain('USES');
  });

  it('boosts enemy damage only while active, then reverts', () => {
    const withTactics = runObserved(777, attackers, defenders);
    const control = runObserved(777, attackers, defenders, { abilityRegistry: {} });
    expect(control.tacticEvents).toHaveLength(0);

    // Identical seeds diverge only at the activation tick, so the power
    // ratio isolates the active multiplier.
    let boostStart = -1;
    let peakRatio = 0;
    const shared = Math.min(withTactics.defenderPowers.length, control.defenderPowers.length);
    const ratios: number[] = [];
    for (let i = 0; i < shared; i++) {
      const base = control.defenderPowers[i];
      const ratio = base > 0 ? withTactics.defenderPowers[i] / base : 1;
      ratios.push(ratio);
      if (ratio > 1.2) {
        if (boostStart === -1) boostStart = i;
        peakRatio = Math.max(peakRatio, ratio);
      }
    }
    // The boost appears...
    expect(boostStart).toBeGreaterThan(-1);
    // ...at its configured strength (x1.25, applied once — never compounding)...
    expect(peakRatio).toBeLessThan(1.3);
    // ...and expires: within a few ticks after the 5-tick duration the
    // powered and baseline runs agree again (no permanent buff).
    const revertWindow = ratios.slice(boostStart + 5, boostStart + 9);
    expect(revertWindow.length).toBeGreaterThan(0);
    expect(revertWindow.some((r) => r < 1.05)).toBe(true);
  });

  it('swings casualties noticeably but never decides the battle alone', () => {
    const withTactics = runBattle(777, attackers, defenders);
    const control = runBattle(777, attackers, defenders, { abilityRegistry: {} });
    // Direction: the player loses MORE troops under Press the Assault.
    expect(withTactics.attackerCasualties).toBeGreaterThan(control.attackerCasualties);
    // Modesty: extra losses stay a small fraction of what fell anyway.
    const delta = withTactics.attackerCasualties - control.attackerCasualties;
    expect(delta / control.attackerCasualties).toBeGreaterThan(0);
    expect(delta / control.attackerCasualties).toBeLessThan(0.25);
    // The tactic alone never flips the result.
    expect(withTactics.outcome).toBe(control.outcome);
  });
});

describe('Rally in live combat', () => {
  // Defenders dominate on power (their bleed rate is small and unclamped),
  // so Rally's x0.85 attacker-power cut visibly slows defender deaths.
  // Two stacks keep the saved bodies above the engine's integer flooring.
  const attackers = [wraiths(26667)];
  const defenders = [
    commanderStack(50, [TACTIC_IDS.rally]),
    {
      unitId: 'elite-melee',
      name: 'Elite Melee',
      count: 250,
      combatPowerEach: 150,
      type: 'melee' as const,
      tags: ['armored' as const],
    },
  ];

  it('triggers from heavy casualties and improves enemy survivability', () => {
    const observed = runObserved(4242, attackers, defenders);
    const announcements = observed.tacticEvents.filter((e) => e.message.includes('USES RALLY'));
    expect(announcements.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < announcements.length; i++) {
      expect(announcements[i].tick - announcements[i - 1].tick).toBeGreaterThanOrEqual(18);
    }
    expect(announcements[0].message).toBe('COMMANDER USES RALLY — Enemy survivability increased.');
    const index = observed.tacticEvents.indexOf(announcements[0]);
    expect(observed.tacticEvents[index - 1].message).toContain('Commander');

    // Mechanism: while Rally holds, the player army's effective power is
    // cut (~x0.85) against the same-seed control, then reverts.
    const controlObserved = runObserved(4242, attackers, defenders, { abilityRegistry: {} });
    expect(controlObserved.tacticEvents).toHaveLength(0);
    const activationTick = announcements[0].tick;
    let minPowerRatio = 1;
    for (let t = activationTick; t < activationTick + 6; t++) {
      const base = controlObserved.attackerPowers[t - 1];
      if (base > 0 && observed.attackerPowers[t - 1] !== undefined) {
        minPowerRatio = Math.min(minPowerRatio, observed.attackerPowers[t - 1]! / base);
      }
    }
    expect(minPowerRatio).toBeLessThan(0.9);
    // ...and the cut expires: a few ticks after the 6-tick window the
    // powered and baseline runs agree again.
    const revertIdx = Math.min(activationTick + 7, observed.attackerPowers.length);
    const revertBase = controlObserved.attackerPowers[revertIdx - 1];
    if (revertBase !== undefined && revertBase > 0 && observed.attackerPowers[revertIdx - 1] !== undefined) {
      expect(observed.attackerPowers[revertIdx - 1]! / revertBase).toBeGreaterThan(0.95);
    }

    // Effect direction, measured mid-fight (end-of-battle totals are
    // smoothed by the engine's fractional-carry arithmetic): during the
    // window strictly fewer defenders have died, by a visible margin.
    let maxSaved = 0;
    for (let t = activationTick; t < activationTick + 6; t++) {
      const saved =
        controlObserved.defenderCasualtiesPerTick[t - 1]! -
        observed.defenderCasualtiesPerTick[t - 1]!;
      maxSaved = Math.max(maxSaved, saved);
    }
    expect(maxSaved).toBeGreaterThanOrEqual(2);

    // Modest swing, outcome untouched.
    const withTactics = runBattle(4242, attackers, defenders);
    const control = runBattle(4242, attackers, defenders, { abilityRegistry: {} });
    const saved = control.defenderCasualties - withTactics.defenderCasualties;
    expect(Math.abs(saved) / control.defenderCasualties).toBeLessThan(0.25);
    expect(withTactics.outcome).toBe(control.outcome);
  });

  it('blocks triggers whose owning stack died before the condition held', () => {
    // Ten officers die to the min-1-per-stack floor long before the huge
    // horde bleeds below its 60% threshold: Press the Assault must NEVER
    // fire, while Rally (its own threshold arrives early) does.
    const observed = runObserved(5150, [wraiths(30000)], [
      commanderStack(10, [TACTIC_IDS.pressTheAssault, TACTIC_IDS.rally]),
    ]);
    const rallies = observed.tacticEvents.filter((e) => e.message.includes('USES RALLY'));
    const presses = observed.tacticEvents.filter((e) => e.message.includes('USES PRESS'));
    expect(rallies.length).toBeGreaterThanOrEqual(1);
    expect(presses).toHaveLength(0);
    expect(observed.final.outcome).toBe('victory');
  });
});

describe('battles without any ability owners are untouched', () => {
  it('plain garrisons produce zero tactic events', () => {
    const result = runBattle(1234, [wraiths(200)], ashGarrison());
    expect(result.events.some((e) => e.kind === 'tactic')).toBe(false);
  });
});

describe('Volley Fire in live combat', () => {
  const rangedStack = (count: number): BattleGroupInput => ({
    unitId: 'recruit-ranged',
    name: 'Recruit Ranged',
    count,
    combatPowerEach: 1,
    type: 'ranged' as const,
  });
  const volleyRegistry = { [TACTIC_IDS.volleyFire]: VOLLEY_FIRE };

  it('gates on the player fielding at least 1,000 surviving ranged units', () => {
    // 500 ranged < the 1,000 requirement -> never fires.
    const gated = observeForces(3131, [{
      unitId: 'skeleton',
      name: 'Skeletons',
      count: 500,
      combatPowerEach: 2,
      type: 'ranged' as const,
      tags: ['bone' as const],
    }], [
      commanderStack(20, [TACTIC_IDS.volleyFire]),
      rangedStack(800),
      rangedStack(800),
    ], volleyRegistry);
    expect(gated.tacticEvents.filter((e) => e.message.includes('USES VOLLEY'))).toHaveLength(0);
  });

  it('kills half the living player ranged units and names the count', () => {
    const attackers = [wraiths(2000), {
      unitId: 'skeleton',
      name: 'Skeletons',
      count: 1500,
      combatPowerEach: 2,
      type: 'ranged' as const,
      tags: ['bone' as const],
    }];
    const defenders = [
      commanderStack(20, [TACTIC_IDS.volleyFire]),
      rangedStack(800),
      rangedStack(800),
    ];
    const observed = observeForces(4141, attackers, defenders, volleyRegistry);
    const control = observeForces(4141, attackers, defenders, {});

    const announcements = observed.tacticEvents.filter((e) =>
      e.message.includes('USES VOLLEY FIRE'),
    );
    expect(announcements.length).toBeGreaterThanOrEqual(1);

    // First-tick delta on the PLAYER'S ranged stack is exactly half of what
    // the control run shows alive after identical attrition.
    const rangedAliveControl = control.rangedPerTick[0]!;
    expect(rangedAliveControl).toBeGreaterThan(1000);
    const killed = rangedAliveControl - observed.rangedPerTick[0]!;
    expect(killed).toBe(Math.floor(rangedAliveControl * 0.5));

    // Non-ranged stacks are untouched by the strike itself.
    expect(observed.wraithPerTick[0]).toBe(control.wraithPerTick[0]);

    // Natural phrasing with the exact number.
    expect(
      observed.tacticEvents.some(
        (e) =>
          e.message === `The first volley kills ${formatExact(killed)} ranged units.` &&
          e.tier === 'advanced',
      ),
    ).toBe(true);

    // Cadence: cooldown (14) runs from the end of the 4-tick window.
    for (let i = 1; i < announcements.length; i++) {
      expect(announcements[i].tick - announcements[i - 1].tick).toBeGreaterThanOrEqual(18);
    }
  });

  /** Small dedicated observer tracking player-side per-stack survivors. */
  function observeForces(
    seed: number,
    attackers: BattleGroupInput[],
    defenders: BattleGroupInput[],
    registry: Record<string, object>,
  ) {
    const sim = new BattleSimulation(
      { id: 'volley', name: 'Volley', terrain: 'plains' },
      attackers.map((g) => ({ ...g })),
      defenders.map((g) => ({ ...g })),
      DEFAULT_BATTLE_PACING,
      { rng: mulberry(seed), abilityRegistry: registry as never },
    );
    const seen = new Set<number>();
    const tacticEvents: { tick: number; message: string; tier?: string }[] = [];
    const wraithPerTick: number[] = [];
    const rangedPerTick: number[] = [];
    let ticks = 0;
    while (!sim.complete && ticks < 100000) {
      sim.advance(interval);
      ticks += 1;
      const snap = sim.snapshot();
      const find = (name: string) => snap.attackerForces.find((f) => f.name === name)?.surviving ?? 0;
      wraithPerTick.push(find('Wraiths'));
      rangedPerTick.push(find('Skeletons'));
      for (const event of snap.events) {
        if (event.kind === 'tactic' && !seen.has(event.id)) {
          seen.add(event.id);
          tacticEvents.push({ tick: ticks, message: event.message, tier: event.tier });
        }
      }
    }
    return { tacticEvents, wraithPerTick, rangedPerTick, final: sim.snapshot() };
  }
});

import { describe, expect, it } from 'vitest';
import { BattleSimulation } from '../src/systems/combat/simulation';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import { DEFAULT_BATTLE_PACING } from '../src/systems/combat/pacing';
import { mulberry } from './helpers';

/**
 * Full-transcript retention: the simulation must keep EVERY beat. The battle
 * log is scrollable and the defeat transcript re-reads the whole fight, so
 * no line may ever be evicted (the old 12-event rolling window silently
 * dropped mid-battle beats).
 */

const interval = DEFAULT_BATTLE_PACING.tickIntervalMs / 1000;

describe('battle log retention', () => {
  it('keeps every beat of a long battle — ids contiguous, nothing evicted', () => {
    const attackers: BattleGroupInput[] = [
      { unitId: 'wraith', name: 'Wraiths', count: 4000, combatPowerEach: 1, type: 'melee', tags: ['spirit'] },
      { unitId: 'skeleton', name: 'Skeletons', count: 3000, combatPowerEach: 2, type: 'ranged', tags: ['bone'] },
    ];
    const defenders: BattleGroupInput[] = [
      { unitId: 'trained-melee', name: 'Trained Melee', count: 40, combatPowerEach: 3, type: 'melee' },
      { unitId: 'recruit-ranged', name: 'Recruit Ranged', count: 60, combatPowerEach: 1, type: 'ranged' },
      { unitId: 'elite-melee', name: 'Elite Melee', count: 25, combatPowerEach: 20, type: 'melee', tags: ['armored'] },
    ];
    const sim = new BattleSimulation(
      { id: 'retention', name: 'Retention', terrain: 'plains' },
      attackers,
      defenders,
      DEFAULT_BATTLE_PACING,
      { rng: mulberry(2024) },
    );
    while (!sim.complete) sim.advance(interval);

    const snapshot = sim.snapshot();
    const events = snapshot.events;

    // The fight must be long enough that the OLD window would have evicted.
    expect(events.length).toBeGreaterThan(12);

    // Contiguity: ids run 1..N with zero gaps — proof nothing was dropped.
    const ids = events.map((event) => event.id);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => index + 1));

    // The very first casualty beat from tick 0 survives to the end.
    const firstBlood = events.find(
      (event) => event.kind === 'casualties' && event.id <= 3,
    );
    expect(firstBlood).toBeDefined();
    expect(events[0]?.kind).toBe('start');
  });

  it('defeat transcripts expose a gapless log through the public snapshot path', () => {
    // Short battles may naturally produce < 12 beats; the invariant that
    // matters is contiguity — nothing between first and last is missing.
    const sim = new BattleSimulation(
      { id: 'r2', name: 'R2', terrain: 'plains' },
      [{ unitId: 'wraith', name: 'Wraiths', count: 60, combatPowerEach: 1, type: 'melee', tags: ['spirit'] }],
      [
        { unitId: 'commander', name: 'Commander', count: 20, combatPowerEach: 150, type: 'melee', tags: ['armored'] },
      ],
      DEFAULT_BATTLE_PACING,
      { rng: mulberry(5) },
    );
    while (!sim.complete) sim.advance(interval);

    const events = sim.snapshot().events;
    const ids = events.map((event) => event.id);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => index + 1));
    expect(events[0]?.kind).toBe('start');
    expect(events.at(-1)?.kind).toBe('climax');
  });
});

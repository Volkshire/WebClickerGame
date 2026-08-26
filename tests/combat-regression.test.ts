import { describe, expect, it } from 'vitest';
import type { BattleGroupInput } from '../src/systems/combat/simulation';
import { ashGarrison, runBattle, wraiths } from './helpers';

/**
 * Golden regression suite: locks the exact behavior of tactic-free battles
 * so adding Commander Tactics can never silently alter existing combat.
 * These numbers were captured BEFORE any ability code existed; if one of
 * them changes, a combat formula/pacing path was touched by mistake.
 *
 * Deliberate baseline refresh (transcript retention): removing the old
 * 12-event rolling window restored previously-EVICTED log beats — event
 * LISTS grew accordingly (G1 below), while every numeric expectation
 * (outcome, timings, casualties, survivors) stayed byte-identical.
 */

const hero = (name: string): BattleGroupInput => ({
  unitId: 'hero',
  name,
  count: 1,
  combatPowerEach: 200,
  type: 'melee',
  tags: ['armored'],
  isHero: true,
  ability: { kind: 'heroic-threat', strength: 0.04 },
  resolve: 5,
});

const golems = (count: number): BattleGroupInput => ({
  unitId: 'flesh-golem',
  name: 'Flesh Golems',
  count,
  combatPowerEach: 25,
  type: 'melee',
  tags: ['flesh'],
});

describe('combat regression baseline (no tactics in play)', () => {
  it('G1: ash-style garrison vs wraith swarm stays byte-identical', () => {
    const result = runBattle(1234, [wraiths(200)], ashGarrison());
    expect(result.outcome).toBe('victory');
    expect(result.elapsedSeconds).toBeCloseTo(13.3, 6);
    expect(result.attackerCasualties).toBe(79);
    expect(result.defenderCasualties).toBe(55);
    expect(result.attackerSurvivors).toEqual([{ name: 'Wraiths', surviving: 121 }]);
    expect(result.fledHeroes).toEqual([]);
    expect(result.events.map((e) => e.kind)).toEqual([
      'start',
      'casualties',
      'casualties',
      'casualties',
      'casualties',
      'casualties',
      // Restored by transcript retention: the old rolling window evicted
      // this beat once 12 lines filled.
      'casualties',
      'attrition',
      'attrition',
      'casualties',
      'casualties',
      'momentum',
      'climax',
    ]);
    expect(result.events.at(-1)?.message).toBe('The Baseline falls. The field is yours.');
    expect(result.events.some((e) => e.kind === 'tactic')).toBe(false);
  });

  it('G2: two Heroes vs thin army stays byte-identical', () => {
    const result = runBattle(4321, [wraiths(500), golems(10)], [hero('Aldric'), hero('Bertrand')]);
    expect(result.outcome).toBe('defeat');
    expect(result.elapsedSeconds).toBeCloseTo(0.7, 6);
    expect(result.attackerCasualties).toBe(510);
    expect(result.defenderCasualties).toBe(0);
    expect(result.attackerSurvivors).toEqual([
      { name: 'Wraiths', surviving: 0 },
      { name: 'Flesh Golems', surviving: 0 },
    ]);
    expect(result.defenderSurvivors).toEqual([
      { name: 'Aldric', surviving: 1 },
      { name: 'Bertrand', surviving: 1 },
    ]);
    expect(result.events.filter((e) => e.kind === 'hero')).toHaveLength(2);
    expect(result.events.some((e) => e.kind === 'tactic')).toBe(false);
  });

  it('G3: tag/armor interactions battle stays byte-identical', () => {
    const result = runBattle(
      99,
      [
        {
          unitId: 'zombie',
          name: 'Zombies',
          count: 120,
          combatPowerEach: 6,
          type: 'melee',
          tags: ['flesh'],
        },
        {
          unitId: 'skeleton',
          name: 'Skeletons',
          count: 80,
          combatPowerEach: 2,
          type: 'ranged',
          tags: ['bone'],
        },
      ],
      [
        {
          unitId: 'elite-melee',
          name: 'Elite Melee',
          count: 25,
          combatPowerEach: 20,
          type: 'melee',
          tags: ['armored'],
        },
      ],
    );
    expect(result.outcome).toBe('victory');
    expect(result.elapsedSeconds).toBeCloseTo(11.2, 6);
    expect(result.attackerCasualties).toBe(184);
    expect(result.defenderCasualties).toBe(25);
    expect(result.attackerSurvivors).toEqual([
      { name: 'Zombies', surviving: 10 },
      { name: 'Skeletons', surviving: 6 },
    ]);
    expect(result.events.some((e) => e.kind === 'tactic')).toBe(false);
  });
});

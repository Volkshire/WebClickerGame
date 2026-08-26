import { describe, expect, it } from 'vitest';
import { AppEvents } from '../src/core/Application';
import type { UpdatePayload } from '../src/core/Application';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { CombatSystem, DEFEAT_LOOT_MULTIPLIER } from '../src/systems/combat/CombatSystem';
import { ResourceSystem } from '../src/systems/resources/ResourceSystem';
import type { ResourceId } from '../src/systems/resources/types';
import { CombatEvents } from '../src/systems/combat/types';
import type { CombatChangedPayload } from '../src/systems/combat/types';
import { AGES } from '../src/systems/combat/world';
import { formatWipePhrase } from '../src/systems/combat/battleFlavor';
import { mulberry } from './helpers';
import { installMemoryStorage } from './support/storage';

/**
 * Loot on BOTH outcomes: defeats pay DEFEAT_LOOT_MULTIPLIER × (target table
 * × enemy casualties); victories pay the full rate. The player must always
 * harvest something from the damage they dealt.
 *
 * Also covers wipe attribution ("X has wiped your forces.") and the truthful
 * end-state power fields used by the defeat transcript's bars.
 */

const ASH = AGES[0];
const TARGET_INDEX = 1;
const target = ASH.targets[TARGET_INDEX];

const wraiths = (count: number) => ({
  unitId: 'wraith',
  name: 'Wraiths',
  count,
  combatPowerEach: 1,
  type: 'melee' as const,
  tags: ['spirit' as const],
});

const doomKnights = (count: number) => ({
  unitId: 'death_knight',
  name: 'Death Knights',
  count,
  combatPowerEach: 75,
  type: 'melee' as const,
  tags: ['armored' as const],
});

function boot(seed: number, targetIndex = TARGET_INDEX) {
  installMemoryStorage();
  const storageShim = (globalThis as unknown as { localStorage: Storage }).localStorage;
  storageShim.setItem(
    'webclickergame.combat',
    JSON.stringify({ v: 1, ageId: 'age-of-ash', clearedInAge: targetIndex }),
  );
  const events = new EventBus();
  const system = new CombatSystem(events, new SaveManager('webclickergame.combat'), {
    rng: mulberry(seed),
  });
  system.restore();

  let last: CombatChangedPayload | null = null;
  events.on<CombatChangedPayload>(CombatEvents.Changed, (payload) => {
    last = payload;
  });

  const driveToResult = () => {
    for (let i = 0; i < 4000; i++) {
      events.emit<UpdatePayload>(AppEvents.Update, { deltaSeconds: 0.7 });
      if ((last as CombatChangedPayload | null)?.phase === 'result') return;
    }
    throw new Error('battle never reached result phase');
  };

  const attack = (
    deployed: ReturnType<typeof wraiths> | ReturnType<typeof doomKnights>,
    power: number,
    targetIndex = TARGET_INDEX,
  ) => {
    expect(
      system.startBattle(ASH.targets[targetIndex].id, [deployed], power),
    ).toBe(true);
    driveToResult();
    const result = (last as CombatChangedPayload).result;
    if (result === null) throw new Error('result missing after battle');
    return result;
  };

  return { attack };
}

describe('loot on both outcomes', () => {
  it('defeat pays the rounded-UP reduced share, as grantable integers', () => {
    const { attack } = boot(4242);
    // 60 wraiths cannot break a garrison that may field a Hero.
    const result = attack(wraiths(60), 60);
    expect(result.outcome).toBe('defeat');
    expect(result.defenderCasualties).toBeGreaterThan(0);
    expect(result.lootGained).not.toBeNull();

    const rate = DEFEAT_LOOT_MULTIPLIER;
    const dc = result.defenderCasualties;
    const expectedBone = Math.ceil((target.loot.bone ?? 0) * dc * rate);
    const expectedFlesh = Math.ceil((target.loot.flesh ?? 0) * dc * rate);
    const expectedIron = Math.ceil((target.loot.iron ?? 0) * dc * rate);
    expect(result.lootGained!.bone).toBe(expectedBone);
    expect(result.lootGained!.flesh).toBe(expectedFlesh);
    expect(result.lootGained!.iron).toBe(expectedIron);

    // Regression: the old bug granted NOTHING because fractional amounts
    // were rejected by ResourceSystem. Every reported amount must be a
    // whole unit the resource system actually accepts.
    const events2 = new EventBus();
    const resources = new ResourceSystem(events2, new SaveManager('webclickergame.resources'));
    for (const [resourceId, amount] of Object.entries(result.lootGained!)) {
      const value = amount ?? 0;
      expect(Number.isSafeInteger(value), `${resourceId} must be an integer`).toBe(true);
      if (value <= 0) continue;
      expect(resources.grant(resourceId as ResourceId, value)).toBe(true);
      expect(resources.getAmount(resourceId as ResourceId)).toBe(value);
    }
  });

  it('victory keeps paying the full rate', () => {
    const { attack } = boot(1717);
    const power = 20000 * 75;
    const result = attack(doomKnights(20000), power);
    expect(result.outcome).toBe('victory');
    expect(result.defenderCasualties).toBeGreaterThan(0);

    const dc = result.defenderCasualties;
    expect(result.lootGained!.bone).toBeCloseTo((target.loot.bone ?? 0) * dc, 9);
    expect(result.lootGained!.flesh).toBeCloseTo((target.loot.flesh ?? 0) * dc, 9);
    expect(result.lootGained!.iron).toBeCloseTo((target.loot.iron ?? 0) * dc, 9);
    expect(Number.isSafeInteger(result.lootGained!.bone)).toBe(true);
  });

  it('defeat share is strictly the victory share halved by the knob', () => {
    expect(DEFEAT_LOOT_MULTIPLIER).toBe(0.5);
  });
});

describe('wipe attribution & truthful end-state', () => {
  function findSeedWithHeroAt(targetIndex: number): number {
    for (let seed = 1; seed < 600; seed++) {
      const { attack } = boot(seed, targetIndex);
      try {
        const probe = attack(wraiths(60), 60, targetIndex);
        if ((probe.wipedByHeroes?.length ?? 0) > 0) return seed;
      } catch {
        // battle may not have produced a hero for this seed; keep hunting
      }
    }
    throw new Error('no seed produced a hero-attributed wipe within 600 tries');
  }

  it('names the Hero that wiped the legion on defeat', () => {
    const seed = findSeedWithHeroAt(TARGET_INDEX);
    const { attack } = boot(seed, TARGET_INDEX);
    const result = attack(wraiths(60), 60, TARGET_INDEX);
    expect(result.outcome).toBe('defeat');
    expect(result.wipedByHeroes?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Truthful bars: the attacker was wiped to nothing.
    expect(result.finalAttackerStrength).toBe(0);
    expect(result.finalDefenderStrength).toBeGreaterThan(0);
  });

  it('credits the garrison when no Hero stands', () => {
    // Target 1 can never roll Heroes (heroChance locked at 0).
    const { attack } = boot(3131, 0);
    const result = attack(wraiths(60), 60, 0);
    expect(result.outcome).toBe('defeat');
    expect(result.wipedByHeroes).toBeUndefined();
    expect(result.finalAttackerStrength).toBe(0);
    expect(result.finalDefenderStrength).toBeGreaterThan(0);
  });

  it('victory never carries wipe attribution', () => {
    const { attack } = boot(1717);
    const result = attack(doomKnights(20000), 20000 * 75);
    expect(result.outcome).toBe('victory');
    expect(result.wipedByHeroes).toBeUndefined();
    expect(result.finalDefenderStrength).toBe(0);
    expect(result.finalAttackerStrength).toBeGreaterThan(0);
  });
});

describe('formatWipePhrase', () => {
  it('handles singular, plural joins, and empty input', () => {
    expect(formatWipePhrase(['Aldric'])).toBe('Aldric has wiped your forces.');
    expect(formatWipePhrase(['Aldric', 'Bertrand'])).toBe(
      'Aldric and Bertrand have wiped your forces.',
    );
    expect(formatWipePhrase(['A', 'B', 'C'])).toBe('A, B and C have wiped your forces.');
    expect(formatWipePhrase([])).toBe('');
  });
});

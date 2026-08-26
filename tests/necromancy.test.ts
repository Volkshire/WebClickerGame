import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { NecromancySystem } from '../src/systems/necromancy/NecromancySystem';
import {
  KNIGHT_SQUIRE_UPGRADE_ID,
  NECROMANCY_UPGRADES,
  ZOMBIE_PLAGUE_UPGRADE_ID,
  necromancyCostAt,
  squiresFor,
} from '../src/systems/necromancy/necromancy';
import { exponentialCostAt } from '../src/systems/buildings/buildings';
import type { BuildingCosts } from '../src/systems/buildings/buildings';
import { installMemoryStorage } from './support/storage';

const KEY = 'webclickergame.necromancy';

beforeEach(() => {
  installMemoryStorage();
});

/** Transactor backed by a mutable balance pool. */
function makeBalances(initial: Record<string, number>) {
  const balances: Record<string, number> = { ...initial };
  const transactor = {
    canAfford(costs: Record<string, number>) {
      return Object.entries(costs).every(([c, a]) => (balances[c] ?? 0) >= a);
    },
    spend(costs: Record<string, number>) {
      for (const [c, a] of Object.entries(costs)) balances[c] = (balances[c] ?? 0) - a;
      return true;
    },
  };
  return { transactor, balances };
}

function makeSystem(balances: Record<string, number> = {}) {
  const events = new EventBus();
  const { transactor, balances: pool } = makeBalances(balances);
  const system = new NecromancySystem(events, new SaveManager(KEY), { transactor });
  system.restore();
  return { events, system, pool };
}

describe('Necromancy catalog', () => {
  it('prices upgrades on the shared exponential curve', () => {
    for (const definition of NECROMANCY_UPGRADES) {
      for (let level = 0; level < definition.maxLevel; level += 1) {
        expect(necromancyCostAt(definition, level)).toEqual(
          exponentialCostAt(definition.baseCosts, definition.growthRate, level),
        );
      }
    }
    // Concrete anchor: Knight & Squire doubles per level across all currencies.
    const knight = NECROMANCY_UPGRADES.find((d) => d.id === KNIGHT_SQUIRE_UPGRADE_ID)!;
    const secondLevel: BuildingCosts = necromancyCostAt(knight, 1);
    expect(secondLevel.souls).toBe((knight.baseCosts.souls ?? 0) * 2);
    expect(secondLevel.iron).toBe((knight.baseCosts.iron ?? 0) * 2);
  });

  it('keeps unique ids and the flagship pair present', () => {
    const ids = new Set(NECROMANCY_UPGRADES.map((d) => d.id));
    expect(ids.size).toBe(NECROMANCY_UPGRADES.length);
    expect(ids.has(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(true);
    expect(ids.has(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(true);
  });
});

describe('NecromancySystem purchases', () => {
  it('buys levels while affordable and refuses past max or balance', () => {
    const { system, pool } = makeSystem({ souls: 200_000, bone: 200_000, iron: 200_000 });

    expect(system.levelOf(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(0);
    expect(system.buy(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(true);
    expect(system.levelOf(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(1);
    expect(pool.souls).toBe(198_000); // debited exactly level-1 cost

    // Drain the pool: further buys fail without state changes.
    pool.souls = 0;
    pool.bone = 0;
    pool.iron = 0;
    expect(system.buy(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(false);
    expect(system.levelOf(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(1);

    // Max level refuses even with deep pockets.
    pool.souls = 10 ** 9;
    pool.bone = 10 ** 9;
    pool.iron = 10 ** 9;
    for (let i = 0; i < 10; i += 1) system.buy(KNIGHT_SQUIRE_UPGRADE_ID);
    expect(system.levelOf(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(5);
    expect(system.buy(KNIGHT_SQUIRE_UPGRADE_ID)).toBe(false);

    expect(system.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(false);
    pool.flesh = 10_000; // the Plague is priced in Flesh
    expect(system.buy(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(true);
    expect(system.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(true);
  });

  it('rejects unknown upgrade ids', () => {
    const { system } = makeSystem({ souls: 999_999 });
    expect(system.buy('future-dark-art')).toBe(false);
  });

  it('persists research across reloads and wipes on run reset', () => {
    const first = makeSystem({ flesh: 50_000 });
    first.system.buy(ZOMBIE_PLAGUE_UPGRADE_ID);
    expect(first.system.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(true);

    // "Reload": a fresh instance over the same storage keeps research.
    const reloaded = makeSystem();
    expect(reloaded.system.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(true);

    // "Prestige": run-scoped reset clears it.
    reloaded.system.resetRun();
    expect(reloaded.system.isOwned(ZOMBIE_PLAGUE_UPGRADE_ID)).toBe(false);
  });
});

describe('Knight & Squire math', () => {
  it('grants level × count squires and nothing otherwise', () => {
    expect(squiresFor(0, 5)).toBe(0);
    expect(squiresFor(3, 1)).toBe(3);
    expect(squiresFor(4, 7)).toBe(28); // bulk-safe
    expect(squiresFor(-1, 5)).toBe(0);
    expect(squiresFor(2, 0)).toBe(0);
    expect(Number.isSafeInteger(squiresFor(5, 100))).toBe(true);
  });
});

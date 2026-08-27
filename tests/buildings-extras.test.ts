import { beforeEach, describe, expect, it } from 'vitest';
import { AppEvents } from '../src/core/Application';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { BuildingSystem } from '../src/systems/buildings/BuildingSystem';
import type { BuildingProduction } from '../src/systems/buildings/BuildingSystem';
import {
  BUILDINGS,
  buildingCostAt,
  exponentialCostAt,
} from '../src/systems/buildings/buildings';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

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

function makeBuildingSystem(balances: Record<string, number>) {
  const events = new EventBus();
  const { transactor } = makeBalances(balances);
  const system = new BuildingSystem(events, new SaveManager('webclickergame.buildings'), {
    transactor,
  });
  const production: BuildingProduction[] = [];
  system.setProduction((amounts) => production.push({ ...amounts }));
  system.restore();
  return { events, system, production };
}

const tick = (events: EventBus, seconds: number): void => {
  events.emit(AppEvents.Update, { deltaSeconds: seconds });
};

describe('Crypt buildings catalog', () => {
  it('gives every building a pre-purchase description', () => {
    for (const definition of BUILDINGS) {
      expect(definition.description.length).toBeGreaterThan(0);
    }
    expect(BUILDINGS.find((b) => b.id === 'ossuary')).toBeDefined();
    expect(BUILDINGS.find((b) => b.id === 'bone-sorting-house')).toBeDefined();
  });

  it('prices leveled purchases on the shared exponential curve', () => {
    const ossuary = BUILDINGS.find((b) => b.id === 'ossuary')!;
    // Level 0 = base; each level doubles (growthRate 2).
    expect(buildingCostAt(ossuary, 0).iron).toBe(3000);
    expect(buildingCostAt(ossuary, 1).iron).toBe(6000);
    expect(buildingCostAt(ossuary, 2).iron).toBe(12000);
    expect(buildingCostAt(ossuary, 2)).toEqual(
      exponentialCostAt(ossuary.baseCosts, ossuary.growthRate, 2),
    );
  });
});

describe('Ossuary passive bone production', () => {
  it('grants whole Bone per owned second via the production hook', () => {
    const { events, system, production } = makeBuildingSystem({ iron: 999_999 });

    tick(events, 2); // no Ossuary yet: nothing
    expect(system.buy('ossuary')).toBe(true); // level 1 → +1/s

    tick(events, 0.5);
    tick(events, 0.4);
    expect(production).toEqual([]); // carry still below one unit

    tick(events, 0.2); // carry reaches 1.1 → grant 1
    expect(production).toEqual([{ bone: 1 }]);
  });

  it('scales with level and keeps fractional carry across ticks', () => {
    const { events, system, production } = makeBuildingSystem({ iron: 999_999 });
    system.buy('ossuary');
    system.buy('ossuary'); // level 2 → +2/s

    tick(events, 0.75);
    tick(events, 0.5);
    expect(production).toEqual([{ bone: 1 }, { bone: 1 }]);
  });

  it('clears the production carry when the run resets', () => {
    const { events, system, production } = makeBuildingSystem({ iron: 999_999 });
    system.buy('ossuary');

    tick(events, 0.9);
    system.resetRun();
    // Reset also wipes the building itself — rebuild, then verify the
    // carry started from zero (0.9s alone must NOT grant).
    expect(system.buy('ossuary')).toBe(true);
    tick(events, 0.9);
    expect(production).toEqual([]); // carry wiped; nothing until 1.0 fresh

    tick(events, 0.2); // 0.9 + 0.2 ≥ 1 after reset
    expect(production).toEqual([{ bone: 1 }]);
  });
});

describe('Fleshworks passive flesh production', () => {
  it('grants whole Flesh per owned second via the production hook', () => {
    const { events, system, production } = makeBuildingSystem({ souls: 999_999, bone: 999_999 });

    tick(events, 2); // no Fleshworks yet: nothing
    expect(system.buy('fleshworks')).toBe(true); // level 1 → +1/s

    tick(events, 0.5);
    tick(events, 0.4);
    expect(production).toEqual([]); // carry still below one unit

    tick(events, 0.2); // carry reaches 1.1 → grant 1
    expect(production).toEqual([{ flesh: 1 }]);
  });

  it('scales with level and keeps fractional carry across ticks', () => {
    const { events, system, production } = makeBuildingSystem({ souls: 999_999, bone: 999_999 });
    system.buy('fleshworks');
    system.buy('fleshworks'); // level 2 → +2/s

    tick(events, 0.75);
    tick(events, 0.5);
    expect(production).toEqual([{ flesh: 1 }, { flesh: 1 }]);
  });

  it('clears the production carry when the run resets', () => {
    const { events, system, production } = makeBuildingSystem({ souls: 999_999, bone: 999_999 });
    system.buy('fleshworks');

    tick(events, 0.9);
    system.resetRun();
    expect(system.buy('fleshworks')).toBe(true);
    tick(events, 0.9);
    expect(production).toEqual([]);

    tick(events, 0.2);
    expect(production).toEqual([{ flesh: 1 }]);
  });
});

describe('Ossuary Auto-Raiser unlock requirement', () => {
  it('is locked when Ossuary is below max level', () => {
    const { system } = makeBuildingSystem({ souls: 999_999, bone: 999_999, iron: 999_999 });
    expect(system.isUnlocked('ossuary-auto-raiser')).toBe(false);
    expect(system.buy('ossuary-auto-raiser')).toBe(false);
  });

  it('unlocks when Ossuary reaches max level', () => {
    const { system } = makeBuildingSystem({ souls: 999_999, bone: 999_999, iron: 999_999 });
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary'); // Ossuary level 3 = max
    expect(system.isUnlocked('ossuary-auto-raiser')).toBe(true);
  });

  it('can be purchased after unlock', () => {
    const { system } = makeBuildingSystem({ souls: 999_999, bone: 999_999, iron: 999_999 });
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary');
    expect(system.buy('ossuary-auto-raiser')).toBe(true);
    expect(system.levelOf('ossuary-auto-raiser')).toBe(1);
  });
});

describe('Ossuary Auto-Raiser skeleton production', () => {
  it('raises Skeletons via the auto-raise hook on timer', () => {
    const events = new EventBus();
    const { transactor } = makeBalances({ souls: 999_999, bone: 999_999, iron: 999_999 });
    const system = new BuildingSystem(events, new SaveManager('webclickergame.buildings'), {
      transactor,
    });
    const raised: number[] = [];
    system.setSkeletonAutoRaise((count) => raised.push(count));
    system.restore();

    // Build Ossuary to max, then buy Auto-Raiser
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary-auto-raiser');

    tick(events, 4); // less than 5s interval: nothing
    expect(raised).toEqual([]);

    tick(events, 1.1); // reaches 5.1s → raises 1 skeleton
    expect(raised).toEqual([1]);
  });

  it('scales with level (raises N skeletons per tick)', () => {
    const events = new EventBus();
    const { transactor } = makeBalances({ souls: 999_999, bone: 999_999, iron: 999_999 });
    const system = new BuildingSystem(events, new SaveManager('webclickergame.buildings'), {
      transactor,
    });
    const raised: number[] = [];
    system.setSkeletonAutoRaise((count) => raised.push(count));
    system.restore();

    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary-auto-raiser');
    system.buy('ossuary-auto-raiser'); // level 2

    tick(events, 5.1); // raises 2 skeletons
    expect(raised).toEqual([2]);
  });

  it('resets production carry on run reset', () => {
    const events = new EventBus();
    const { transactor } = makeBalances({ souls: 999_999, bone: 999_999, iron: 999_999 });
    const system = new BuildingSystem(events, new SaveManager('webclickergame.buildings'), {
      transactor,
    });
    const raised: number[] = [];
    system.setSkeletonAutoRaise((count) => raised.push(count));
    system.restore();

    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary-auto-raiser');

    tick(events, 4); // accumulate 4s
    system.resetRun(); // resets timer

    // Rebuild after reset
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary');
    system.buy('ossuary-auto-raiser');
    tick(events, 4); // only 4s fresh, should not trigger
    expect(raised).toEqual([]);
  });
});

describe('Fleshworks and Auto-Raiser in catalog', () => {
  it('both new buildings exist with valid definitions', () => {
    const fleshworks = BUILDINGS.find((b) => b.id === 'fleshworks');
    const autoRaiser = BUILDINGS.find((b) => b.id === 'ossuary-auto-raiser');
    expect(fleshworks).toBeDefined();
    expect(autoRaiser).toBeDefined();
    expect(fleshworks!.maxLevel).toBeGreaterThan(1);
    expect(autoRaiser!.maxLevel).toBeGreaterThan(1);
  });

  it('Auto-Raiser has an unlock requirement on Ossuary', () => {
    const autoRaiser = BUILDINGS.find((b) => b.id === 'ossuary-auto-raiser')!;
    expect(autoRaiser.unlockRequirement).toEqual({ buildingId: 'ossuary', minLevel: 3 });
  });

  it('Fleshworks has no unlock requirement', () => {
    const fleshworks = BUILDINGS.find((b) => b.id === 'fleshworks')!;
    expect(fleshworks.unlockRequirement).toBeUndefined();
  });
});

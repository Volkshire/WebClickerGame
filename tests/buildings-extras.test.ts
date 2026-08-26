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
  console.log('[dbg] keys after fresh shim:', JSON.stringify(Object.keys(globalThis.localStorage)));
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
    console.log('[dbg] blob BEFORE restore:', globalThis.localStorage.getItem('webclickergame.buildings'));
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
    console.log('[dbg] level:', system.levelOf('ossuary'));
    console.log('[dbg] blob:', globalThis.localStorage.getItem('webclickergame.buildings'));

    tick(events, 0.75);
    console.log('[dbg] after 0.75:', JSON.stringify(production), 'carry-visible-grants');
    tick(events, 0.5);
    console.log('[dbg] after 0.5:', JSON.stringify(production));
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

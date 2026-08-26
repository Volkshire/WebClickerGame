import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { AchievementSystem } from '../src/systems/achievements/AchievementSystem';
import { ACHIEVEMENTS } from '../src/systems/achievements/achievements';
import { CONDITION_EVALUATORS, getConditionMetric } from '../src/systems/achievements/conditionEvaluators';
import type { AchievementDefinition } from '../src/systems/achievements/types';
import type { AchievementViewData } from '../src/systems/achievements/types';
import type { GameStatsSnapshot } from '../src/systems/achievements/types';
import { installMemoryStorage } from './support/storage';

const KEY = 'webclickergame.achievements';

beforeEach(() => {
  installMemoryStorage();
});

function stats(overrides: Partial<GameStatsSnapshot> = {}): GameStatsSnapshot {
  return {
    lifetimeClicks: 0,
    souls: 0,
    targetsCleared: 0,
    legionSize: 0,
    conqueredAges: 0,
    prestigeCount: 0,
    ...overrides,
  };
}

interface Harness {
  events: EventBus;
  system: AchievementSystem;
}

function makeSystem(): Harness {
  const events = new EventBus();
  const system = new AchievementSystem(events, new SaveManager(KEY));
  system.restore();
  return { events, system };
}

function collect(harness: Harness) {
  const completed: string[] = [];
  const changed: number[] = [];
  harness.events.on('achievements:completed', (payload: { id: string }) => completed.push(payload.id));
  harness.events.on('achievements:changed', (payload: { completedCount: number }) =>
    changed.push(payload.completedCount),
  );
  return { completed, changed };
}

describe('AchievementSystem', () => {
  it('completes an achievement and emits its reward exactly once', () => {
    const harness = makeSystem();
    const spy = collect(harness);

    harness.system.evaluate(stats({ lifetimeClicks: 34 }));
    expect(spy.completed).toEqual([]);

    harness.system.evaluate(stats({ lifetimeClicks: 100 }));
    expect(spy.completed).toEqual(['first-harvest']);
    expect(spy.changed.at(-1)).toBe(1);
  });

  it('never re-awards a reward after completion', () => {
    const harness = makeSystem();
    const spy = collect(harness);

    harness.system.evaluate(stats({ souls: 20000 }));
    harness.system.evaluate(stats({ souls: 999999 }));
    harness.system.evaluate(stats());

    expect(spy.completed).toEqual(['soul-hoard']); // single emission
    expect(spy.changed.filter((count) => count > 0)).toEqual([1]);
  });

  it('reports progress capped at the goal', () => {
    const harness = makeSystem();
    let lastViews: { id: string; progress: { current: number; goal: number } | null }[] = [];
    harness.events.on('achievements:changed', (payload: {
      achievements: { id: string; progress: { current: number; goal: number } | null }[];
    }) => {
      lastViews = payload.achievements;
    });

    harness.system.evaluate(stats({ lifetimeClicks: 34 }));

    const harvest = lastViews.find((view) => view.id === 'first-harvest');
    expect(harvest?.progress).toEqual({ current: 34, goal: 100 });

    // Capped at the goal once exceeded (achievement still incomplete).
    harness.system.evaluate(stats({ lifetimeClicks: 99 }));
    expect(lastViews.find((view) => view.id === 'first-harvest')?.progress).toEqual({
      current: 99,
      goal: 100,
    });
  });

  it('persists completions across reloads without re-awarding', () => {
    const first = makeSystem();
    first.system.evaluate(stats({ conqueredAges: 1, prestigeCount: 0 }));

    const second = makeSystem(); // same storage = reload
    const spy = collect(second);
    second.system.evaluate(stats({ conqueredAges: 5 }));

    expect(spy.completed).not.toContain('era-breaker'); // already latched
    expect(spy.completed).toContain('double-conquest'); // still completable
  });

  it('awards Prestige Points through the source ledger at most once', () => {
    const harness = makeSystem();
    harness.system.evaluate(stats({ prestigeCount: 1 }));

    const rewards = harness.system.getCompletedPrestigePointRewards();
    expect(rewards).toContainEqual({ id: 'ascended', amount: 1 });
  });

  it('never completes achievements with unregistered condition kinds', () => {
    const fake: AchievementDefinition = {
      id: 'from-the-future',
      name: 'From The Future',
      description: 'References a system that does not exist yet.',
      condition: { kind: 'commanders-defeated', amount: 1 },
      reward: { type: 'prestige-points', amount: 1 },
    };
    (ACHIEVEMENTS as unknown as AchievementDefinition[]).push(fake);
    try {
      const harness = makeSystem();
      const spy = collect(harness);
      harness.system.evaluate(
        stats({ prestigeCount: 10, lifetimeClicks: 10 ** 6 }),
      );
      expect(spy.completed).not.toContain('from-the-future');
    } finally {
      (ACHIEVEMENTS as unknown as AchievementDefinition[]).pop();
    }
  });

  it('supports future condition kinds by extending the registry only', () => {
    (CONDITION_EVALUATORS as Record<string, unknown>)['commanders-defeated'] = (
      s: GameStatsSnapshot,
    ) => s.prestigeCount / 10; // stand-in metric
    const fake: AchievementDefinition = {
      id: 'future-proof',
      name: 'Future Proof',
      description: 'Completes once its kind has an evaluator.',
      condition: { kind: 'commanders-defeated', amount: 1 },
      reward: { type: 'none' },
    };
    (ACHIEVEMENTS as unknown as AchievementDefinition[]).push(fake);
    try {
      const harness = makeSystem();
      const spy = collect(harness);
      harness.system.evaluate(stats({ prestigeCount: 10 }));
      expect(getConditionMetric('commanders-defeated')).not.toBeNull();
      expect(spy.completed).toContain('future-proof');
    } finally {
      (ACHIEVEMENTS as unknown as AchievementDefinition[]).pop();
      delete (CONDITION_EVALUATORS as Record<string, unknown>)['commanders-defeated'];
    }
  });

  it('keeps every shipped definition resolvable by the registry', () => {
    for (const definition of ACHIEVEMENTS) {
      expect(getConditionMetric(definition.condition.kind)).not.toBeNull();
    }
  });
});

describe('spoiler masking', () => {
  /** Subscribes BEFORE construction so even a no-change evaluate keeps views fresh. */
  function makeCapturingSystem(): {
    system: AchievementSystem;
    views: () => AchievementViewData[];
  } {
    const events = new EventBus();
    let captured: AchievementViewData[] = [];
    events.on('achievements:changed', (payload: { achievements: AchievementViewData[] }) => {
      captured = payload.achievements;
    });
    const system = new AchievementSystem(events, new SaveManager(KEY));
    system.restore(); // unconditional publish seeds `captured`
    return { system, views: () => captured };
  }

  it('masks undiscovered spoiler achievements', () => {
    const { system, views } = makeCapturingSystem();

    system.evaluate(stats());

    expect(views().find((view) => view.id === 'blood-price')).toEqual({
      id: 'blood-price',
      name: '???',
      description: 'Hidden achievement',
      completed: false,
      progress: null,
      rewardText: '',
      masked: true,
    });
  });

  it('keeps non-spoiler achievements fully visible with live progress', () => {
    const { system, views } = makeCapturingSystem();

    system.evaluate(stats({ lifetimeClicks: 34 }));

    const harvest = views().find((view) => view.id === 'first-harvest');
    expect(harvest).toMatchObject({
      name: 'First Harvest',
      description: 'Harvest Souls 100 times by hand.',
      masked: false,
      progress: { current: 34, goal: 100 },
      rewardText: '+1 Prestige Point',
    });
  });

  it('unmasks permanently once the spoiler completes', () => {
    const { system, views } = makeCapturingSystem();

    system.evaluate(stats({ targetsCleared: 1 }));
    expect(views().find((view) => view.id === 'blood-price')).toMatchObject({
      name: 'Blood Price',
      description: 'Clear your first campaign target.',
      completed: true,
      masked: false,
      progress: { current: 1, goal: 1 },
    });

    // Later evaluations never re-mask a completed achievement.
    system.evaluate(stats({ targetsCleared: 99 }));
    expect(views().find((view) => view.id === 'blood-price')?.masked).toBe(false);
  });

  it('still completes and emits its reward while masked', () => {
    const events = new EventBus();
    const spy = { completed: [] as string[] };
    const rewards: string[] = [];
    events.on('achievements:completed', (payload: { id: string; reward: { type: string; amount?: number } }) => {
      spy.completed.push(payload.id);
      if (payload.id === 'first-recruit') rewards.push(`${payload.reward.type}:${payload.reward.amount}`);
    });
    const system = new AchievementSystem(events, new SaveManager(KEY));
    system.restore();

    system.evaluate(stats());
    expect(spy.completed).not.toContain('first-recruit');

    system.evaluate(stats({ legionSize: 3 }));
    expect(spy.completed).toContain('first-recruit');
    expect(rewards).toEqual(['prestige-points:1']);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { AchievementSystem } from '../src/systems/achievements/AchievementSystem';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import { achievementSourceId } from '../src/systems/prestige/sources';
import type { GameStatsSnapshot } from '../src/systems/achievements/types';
import { installMemoryStorage } from './support/storage';

const ACH_KEY = 'webclickergame.achievements';
const PRESTIGE_KEY = 'webclickergame.prestige';

let events: EventBus;
let achievementSystem: AchievementSystem;
let prestige: PrestigeSystem;

beforeEach(() => {
  installMemoryStorage();
  events = new EventBus();
  achievementSystem = new AchievementSystem(events, new SaveManager(ACH_KEY));
  prestige = new PrestigeSystem(events, new SaveManager(PRESTIGE_KEY));
  achievementSystem.restore();
  prestige.restore();
  // Prestige gate for testing (as main.ts does after combat restores).
  prestige.setCampaignCompleted(true);
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

function completedIds(): string[] {
  const completed: string[] = [];
  events.on('achievements:completed', (payload: { id: string }) => completed.push(payload.id));
  return completed;
}

describe('Achievement + Prestige lifecycle', () => {
  it('completes a current-run-scoped spoiler achievement, survives Prestige + reload, and remains visible', () => {
    const completed = completedIds();

    // Complete era-breaker (conquered-ages >= 1, spoiler=true).
    achievementSystem.evaluate(stats({ conqueredAges: 1 }));
    expect(completed).toEqual(['era-breaker']);

    // Perform Prestige (runs perform, bumps prestigeCount, clears pending).
    const prestResult = prestige.perform();
    expect(prestResult.ok).toBe(true);
    expect(prestige.count).toBe(1);
    // Note: catch-up routing of 'ascended' (prestige-count >= 1) is tested
    // in the boot-ordering test; here we just verify the achievement latch.

    // After Prestige, run state resets: conqueredAges -> 0.
    // Re-evaluate with zeroed snapshot; must NOT re-complete era-breaker.
    // ascended also completes now (prestigeCount=1) - a separate achievement.
    achievementSystem.evaluate(stats({ conqueredAges: 0, prestigeCount: 1 }));
    expect(completed).toEqual(['era-breaker', 'ascended']); // no duplicate of era-breaker

    // Reload: construct fresh AchievementSystem over same storage.
    const freshEvents = new EventBus();
    const freshAch = new AchievementSystem(freshEvents, new SaveManager(ACH_KEY));
    freshAch.restore();

    // The completed achievement must still be latched and visible (not masked).
    const completedAgain: string[] = [];
    freshEvents.on('achievements:completed', (p) => completedAgain.push(p.id));
    // Evaluate with zeroed state should not complete anything new.
    freshAch.evaluate(stats({ conqueredAges: 0, prestigeCount: 1 }));
    expect(completedAgain).toEqual([]);

    // Verify view data: era-breaker should be completed=true, masked=false.
    let capturedViews: { id: string; completed: boolean; masked: boolean; name: string }[] = [];
    freshEvents.on('achievements:changed', (payload: { achievements: typeof capturedViews }) => {
      capturedViews = payload.achievements;
    });
    // Force a publish with non-zero stat to ensure the view payload is captured.
    freshAch.evaluate(stats({ lifetimeClicks: 1 }));

    const era = capturedViews.find((v) => v.id === 'era-breaker');
    expect(era).toBeDefined();
    expect(era!.completed).toBe(true);
    expect(era!.masked).toBe(false);
    expect(era!.name).toBe('Era Breaker'); // not '???'
  });

  it('completes soul-hoard shortly before Prestige, survives Prestige + reload', () => {
    const completed = completedIds();

    // Complete soul-hoard (souls-current >= 10000, non-spoiler).
    achievementSystem.evaluate(stats({ souls: 10000 }));
    expect(completed).toEqual(['soul-hoard']);

    // Perform Prestige.
    prestige.perform();

    // Run state resets -> souls drops to 0 (from starting boons, etc.).
    // Re-evaluate; must not re-complete soul-hoard. ascended also completes now
    // (prestigeCount=1) - a separate achievement, not a duplicate.
    achievementSystem.evaluate(stats({ souls: 0, prestigeCount: 1 }));
    expect(completed).toEqual(['soul-hoard', 'ascended']);

    // Reload fresh.
    const freshEvents = new EventBus();
    const freshAch = new AchievementSystem(freshEvents, new SaveManager(ACH_KEY));
    freshAch.restore();

    // Capture views with listener registered BEFORE evaluate.
    let views: { id: string; completed: boolean }[] = [];
    freshEvents.on('achievements:changed', (payload: { achievements: typeof views }) => {
      views = payload.achievements;
    });
    const completedAgain: string[] = [];
    freshEvents.on('achievements:completed', (p) => completedAgain.push(p.id));
    // Force publish with non-zero stat.
    freshAch.evaluate(stats({ lifetimeClicks: 1, prestigeCount: 1 }));
    expect(completedAgain).toEqual([]);

    // Verify it's still completed in view data.
    const soulHoard = views.find((v) => v.id === 'soul-hoard');
    expect(soulHoard!.completed).toBe(true);
  });

  it('boot ordering: achievements restore before prestige, catch-up routing does not duplicate rewards', () => {
    // Simulate the main.ts boot order: prestige.restore() THEN achievementSystem.restore()
    // with existing saves, then catch-up route.
    // Seed a save where era-breaker is already completed (from a prior session).
    const seedEvents = new EventBus();
    const seedAch = new AchievementSystem(seedEvents, new SaveManager(ACH_KEY));
    seedAch.restore();
    seedAch.evaluate(stats({ conqueredAges: 1 }));
    // Seed also has ascended completed (prestigeCount >= 1).
    seedAch.evaluate(stats({ prestigeCount: 1 }));

    // Now simulate a fresh boot: prestige.restore() first, then achievements.restore(),
    // then catch-up via getCompletedPrestigePointRewards().
    const bootPrestige = new PrestigeSystem(new EventBus(), new SaveManager(PRESTIGE_KEY));
    bootPrestige.restore();
    bootPrestige.setCampaignCompleted(true);

    const bootAch = new AchievementSystem(new EventBus(), new SaveManager(ACH_KEY));
    bootAch.restore();

    const rewards = bootAch.getCompletedPrestigePointRewards();
    // Should have era-breaker (spoiler, current-run-scoped, completed) and ascended.
    // Both grant 1 PP.
    expect(rewards).toContainEqual({ id: 'era-breaker', amount: 1 });
    expect(rewards).toContainEqual({ id: 'ascended', amount: 1 });

    // Route through prestige.reportReward - claimed ledger must prevent dupes.
    for (const r of rewards) {
      const ok = bootPrestige.reportReward(achievementSourceId(r.id), r.amount);
      expect(ok).toBe(true);
    }

    // After first report, both rewards are pending (waiting for perform).
    expect(bootPrestige.pendingPoints).toBe(2);

    // Second report of same sources must be idempotent (no pending accumulation).
    for (const r of rewards) {
      const ok = bootPrestige.reportReward(achievementSourceId(r.id), r.amount);
      expect(ok).toBe(true);
    }
    expect(bootPrestige.pendingPoints).toBe(2); // unchanged
    expect(bootPrestige.points).toBe(0); // not banked until perform()
  });

  it('other uncompleted achievements follow existing design: spoiler stays masked, non-spoiler visible with progress', () => {
    // Register listener BEFORE any evaluate so we capture the initial publish.
    let views: { id: string; completed: boolean; masked: boolean; progress: { current: number; goal: number } | null }[] = [];
    events.on('achievements:changed', (payload: { achievements: typeof views }) => {
      views = payload.achievements;
    });

    // No achievements completed yet. Force a publish by evaluating with a
    // non-zero stat (restore publishes at 0/100, this publishes at 1/100).
    achievementSystem.evaluate(stats({ lifetimeClicks: 1 }));

    // blood-price (spoiler, not completed) -> masked.
    const blood = views.find((v) => v.id === 'blood-price');
    expect(blood!.completed).toBe(false);
    expect(blood!.masked).toBe(true);
    expect(blood!.progress).toBeNull();

    // first-harvest (non-spoiler, not completed) -> visible with progress.
    const harvest = views.find((v) => v.id === 'first-harvest');
    expect(harvest!.completed).toBe(false);
    expect(harvest!.masked).toBe(false);
    expect(harvest!.progress).toEqual({ current: 1, goal: 100 });
  });
});
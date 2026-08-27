import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager, SAVE_SCHEMA_VERSION } from '../src/core/SaveManager';
import { AppEvents } from '../src/core/Application';
import { ClickerSystem } from '../src/systems/clicker/ClickerSystem';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

const KEY = 'test.clicker';

function makeClicker(clock: () => number): {
  clicker: ClickerSystem;
  events: EventBus;
  saves: SaveManager;
} {
  const events = new EventBus();
  const saves = new SaveManager(KEY);
  const clicker = new ClickerSystem(events, saves, clock);
  return { clicker, events, saves };
}

function seedGeneratorState(
  saves: SaveManager,
  clicker: ClickerSystem,
  souls: number,
  generatorId: string,
  owned: number,
  lastSeen: number | null,
): void {
  saves.save({
    v: SAVE_SCHEMA_VERSION,
    souls,
    totalClicks: 0,
    upgrades: {},
    generators: { [generatorId]: owned },
    lastSeen,
  });
  clicker.restore();
}

describe('Offline gain double-count prevention', () => {
  it('tick() and claimOfflineProgress() do not double-count the same period', () => {
    let time = 1000;
    const { clicker, events, saves } = makeClicker(() => time);
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, null);

    expect(clicker.soulsPerSecond).toBe(1);

    // Tab goes hidden: Flush persists state, sets lastSeen = 1000.
    events.emit(AppEvents.Flush);

    // Simulate 10 seconds of background ticks (bg interval: 700ms each).
    const ticks = 14; // 14 * 700ms = 9800ms ≈ 10s
    for (let i = 0; i < ticks; i++) {
      time += 700;
      events.emit(AppEvents.Update, { deltaSeconds: 0.7 });
    }
    // time = 1000 + 9800 = 10800

    const soulsAfterTicks = clicker.souls;

    // Tab returns: claim offline progress.
    const offlineGain = clicker.claimOfflineProgress();

    // The offline gain should be negligible (< 1 second worth)
    // because tick() updated lastSeen on every tick.
    expect(offlineGain).toBeLessThanOrEqual(1);

    // Total souls should be approximately 10 (10s * 1 soul/s).
    // Must NOT be approximately 20 (which would be double-counted).
    const totalElapsed = (time - 1000) / 1000; // ~9.8 seconds
    expect(clicker.souls).toBeGreaterThanOrEqual(Math.floor(totalElapsed));
    expect(clicker.souls).toBeLessThanOrEqual(Math.ceil(totalElapsed) + 1);
  });

  it('claimOfflineProgress() returns 0 when called again without advancing time', () => {
    let time = 1000;
    const { clicker, saves } = makeClicker(() => time);
    // Seed with a lastSeen in the past so the claim has something to credit.
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, 1000);

    // Advance time by 5 seconds without running ticks.
    time += 5000;

    // First claim: should grant ~5 seconds of production.
    const gain1 = clicker.claimOfflineProgress();
    expect(gain1).toBe(5);

    // Second claim without advancing time: must return 0.
    const gain2 = clicker.claimOfflineProgress();
    expect(gain2).toBe(0);
  });

  it('multiple rapid visibility changes do not compound gains', () => {
    let time = 1000;
    const { clicker, events, saves } = makeClicker(() => time);
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, null);

    const cycles = 10;
    for (let cycle = 0; cycle < cycles; cycle++) {
      // Tab hidden: flush saves lastSeen.
      events.emit(AppEvents.Flush);

      // ~1.4 seconds of background ticks (2 ticks at 700ms).
      time += 700;
      events.emit(AppEvents.Update, { deltaSeconds: 0.7 });
      time += 700;
      events.emit(AppEvents.Update, { deltaSeconds: 0.7 });

      // Tab returns: claim offline.
      clicker.claimOfflineProgress();
    }

    // Total real elapsed: cycles * 1400ms = 14000ms = 14s.
    // Total souls should be approximately 14 (1 soul/s * 14s).
    // Must NOT be 28+ (which would be double-counted).
    // Allow a small margin for fractional-soul carryover mechanics.
    const totalElapsed = (time - 1000) / 1000; // 14
    expect(clicker.souls).toBeGreaterThanOrEqual(Math.floor(totalElapsed) - 2);
    expect(clicker.souls).toBeLessThanOrEqual(Math.ceil(totalElapsed) + 2);
  });

  it('normal production resumes correctly after returning from hidden', () => {
    let time = 1000;
    const { clicker, events, saves } = makeClicker(() => time);
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, null);

    // Tab hidden for ~5 seconds.
    events.emit(AppEvents.Flush);
    for (let i = 0; i < 7; i++) {
      time += 700;
      events.emit(AppEvents.Update, { deltaSeconds: 0.7 });
    }
    // time = 1000 + 4900 = 5900

    // Tab returns.
    clicker.claimOfflineProgress();
    const soulsAfterReturn = clicker.souls;

    // Simulate 1 second of normal rAF production (60 frames at ~16.67ms).
    for (let i = 0; i < 60; i++) {
      time += 16;
      events.emit(AppEvents.Update, { deltaSeconds: 0.016 });
    }
    // time ≈ 5900 + 960 = 6860

    const soulsAfterResume = clicker.souls;
    const gained = soulsAfterResume - soulsAfterReturn;

    // Should have gained approximately 1 second of production (~1 soul).
    expect(gained).toBeGreaterThanOrEqual(0);
    expect(gained).toBeLessThanOrEqual(2);
  });

  it('boot-time offline claim still works when ticks were not running', () => {
    let time = 1000;
    const { clicker, saves } = makeClicker(() => time);

    // Simulate a previous session: state saved with lastSeen = 1000.
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, 1000);

    // Page was closed. Time passes. No ticks run (page was closed).
    time += 30_000; // 30 seconds

    // Page reloads, restores state, and calls claimOfflineProgress().
    clicker.restore();
    const offlineGain = clicker.claimOfflineProgress();

    // Should credit exactly 30 seconds of production.
    expect(offlineGain).toBe(30);
  });

  it('tick update of lastSeen persists through save and survives save/restore cycle', () => {
    let time = 1000;
    const { clicker, events, saves } = makeClicker(() => time);
    seedGeneratorState(saves, clicker, 0, 'grave-keeper', 1, null);

    // Tab hidden.
    events.emit(AppEvents.Flush);

    // Run ticks that accumulate enough for a passive save (>=5s).
    for (let i = 0; i < 8; i++) {
      time += 700;
      events.emit(AppEvents.Update, { deltaSeconds: 0.7 });
    }
    // time = 1000 + 5600 = 6600. A save() should have fired around tick 7-8.

    const soulsAfterTicks = clicker.souls;
    expect(soulsAfterTicks).toBeGreaterThan(0);

    // Simulate page reload: read from localStorage and restore.
    const reloaded = makeClicker(() => time);
    reloaded.saves.save({
      v: SAVE_SCHEMA_VERSION,
      souls: 0,
      totalClicks: 0,
      upgrades: {},
      generators: { 'grave-keeper': 1 },
      lastSeen: null,
    });
    // Manually load the saved state to simulate real reload.
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    reloaded.saves.save(raw);
    reloaded.clicker.restore();

    // claimOfflineProgress on reload should claim very little
    // because save() persisted the recent lastSeen from tick().
    const gain = reloaded.clicker.claimOfflineProgress();
    expect(gain).toBeLessThanOrEqual(1);
  });
});

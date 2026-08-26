import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager } from '../src/core/SaveManager';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import { achievementSourceId, ageMilestoneSourceId } from '../src/systems/prestige/sources';
import type { PrestigeChangedPayload } from '../src/systems/prestige/types';
import { installMemoryStorage } from './support/storage';

const KEY = 'webclickergame.prestige';

let seed: (key: string, value: string) => void;
let failNextWrites: (count: number) => void;

beforeEach(() => {
  const memory = installMemoryStorage();
  seed = memory.seed;
  failNextWrites = memory.failNextWrites;
});

interface Harness {
  events: EventBus;
  system: PrestigeSystem;
  payloads: PrestigeChangedPayload[];
}

function makeSystem(): Harness {
  const events = new EventBus();
  const system = new PrestigeSystem(events, new SaveManager(KEY));
  system.restore();
  // Age-conquered gate as the wiring layer would set it.
  system.setCampaignCompleted(true);

  const payloads: PrestigeChangedPayload[] = [];
  events.on<PrestigeChangedPayload>('prestige:changed', (payload) => payloads.push(payload));
  return { events, system, payloads };
}

describe('Prestige point rewards', () => {
  it('awards the correct pending reward for a first Age completion', () => {
    const { system } = makeSystem();

    expect(system.reportReward(ageMilestoneSourceId('age-of-ash'), 1)).toBe(true);
    expect(system.pendingPoints).toBe(1);
    expect(system.points).toBe(0); // not banked until Prestige
  });

  it('does not award another point when repeating an already completed Age', () => {
    const { system } = makeSystem();

    expect(system.reportReward(ageMilestoneSourceId('age-of-ash'), 1)).toBe(true);
    expect(system.reportReward(ageMilestoneSourceId('age-of-ash'), 1)).toBe(true); // idempotent
    expect(system.pendingPoints).toBe(1);

    // Claim by prestiging, then re-conquer the same Age in the next run.
    expect(system.perform()).toMatchObject({ ok: true, pointsGained: 1 });
    system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);
    expect(system.pendingPoints).toBe(0);
    expect(system.points).toBe(1);
  });

  it('lets multiple completed Ages provide multiple points', () => {
    const { system } = makeSystem();

    system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);
    system.reportReward(ageMilestoneSourceId('age-of-iron'), 1);
    system.reportReward(ageMilestoneSourceId('age-of-kings'), 1);
    expect(system.pendingPoints).toBe(3);
  });

  it('claims all pending rewards when performing the Prestige', () => {
    const { system, payloads } = makeSystem();

    system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);
    system.reportReward(achievementSourceId('ascended'), 2);

    const result = system.perform();
    expect(result).toEqual({ ok: true, pointsGained: 3 });
    expect(system.count).toBe(1);
    expect(system.points).toBe(3);
    expect(system.pendingPoints).toBe(0);
    expect(payloads.at(-1)).toMatchObject({ points: 3, pendingPoints: 0 });

    // A Prestige with nothing pending banks zero.
    expect(system.perform()).toEqual({ ok: true, pointsGained: 0 });
  });

  it('persists points and claimed rewards across run resets', () => {
    const first = makeSystem();
    first.system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);
    first.system.reportReward(ageMilestoneSourceId('age-of-iron'), 1);
    first.system.perform();

    // "Reset" = every run-scoped system is wiped while this blob survives;
    // a fresh instance reading the same storage must see the same balance.
    const second = makeSystem();
    expect(second.system.count).toBe(1);
    expect(second.system.points).toBe(2);

    // The claimed ledger survived too: no refarming either Age.
    second.system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);
    second.system.reportReward(ageMilestoneSourceId('age-of-iron'), 1);
    expect(second.system.pendingPoints).toBe(0);
  });

  it('aborts the Prestige without losing state when storage fails', () => {
    const { system } = makeSystem();
    system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);

    failNextWrites(2); // initial write + read-back retry both fail
    expect(system.perform()).toEqual({ ok: false, reason: 'storage' });

    // Nothing was committed: pending reward still claimable.
    expect(system.pendingPoints).toBe(1);
    expect(system.points).toBe(0);
    expect(system.count).toBe(0);
  });

  it('loads legacy saves that predate points and ledgers', () => {
    seed(KEY, JSON.stringify({ v: 1, count: 4 }));

    const { system } = makeSystem();
    expect(system.count).toBe(4);
    expect(system.points).toBe(0);
    expect(system.pendingPoints).toBe(0);
  });

  it('keeps unclaimed pending rewards across reloads', () => {
    makeSystem().system.reportReward(ageMilestoneSourceId('age-of-ash'), 1);

    const afterReload = makeSystem();
    expect(afterReload.system.pendingPoints).toBe(1);
    afterReload.system.perform();
    expect(afterReload.system.points).toBe(1);
  });
});

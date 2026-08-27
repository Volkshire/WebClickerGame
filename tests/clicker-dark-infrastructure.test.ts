import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager, SAVE_SCHEMA_VERSION } from '../src/core/SaveManager';
import { ClickerSystem } from '../src/systems/clicker/ClickerSystem';
import { ClickerEvents } from '../src/systems/clicker/types';
import type { ClickerChangedPayload } from '../src/systems/clicker/types';
import {
  GENERATORS,
  GENERATOR_REVEAL_FACTOR,
  revealedGeneratorIds,
} from '../src/systems/clicker/generators';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

const KEY = 'webclickergame.clicker';

function ownedOf(payload: ClickerChangedPayload): Record<string, number> {
  const map: Record<string, number> = {};
  for (const generator of payload.generators) map[generator.id] = generator.owned;
  return map;
}

interface Harness {
  clicker: ClickerSystem;
  saves: SaveManager;
  events: EventBus;
  last: () => ClickerChangedPayload;
}

function makeHarness(getStartingGeneratorOwned: () => number): Harness {
  const events = new EventBus();
  const saves = new SaveManager(KEY, () => {});
  const clicker = new ClickerSystem(events, saves, () => 1_000_000, {
    getStartingGeneratorOwned,
  });
  let latest: ClickerChangedPayload | null = null;
  events.on<ClickerChangedPayload>(ClickerEvents.Changed, (payload) => {
    latest = payload;
  });
  return { clicker, saves, events, last: () => latest! };
}

function seedSouls(harness: Harness, souls: number): void {
  const previous = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
    upgrades?: Record<string, number>;
    generators?: Record<string, number>;
  };
  harness.saves.save({
    v: SAVE_SCHEMA_VERSION,
    souls,
    totalClicks: 0,
    upgrades: previous.upgrades ?? {},
    generators: previous.generators ?? {},
    lastSeen: null,
  });
  harness.clicker.restore();
}

describe('revealedGeneratorIds (shared source of truth)', () => {
  it('reveals the first unowned tier even at zero souls', () => {
    const revealed = revealedGeneratorIds(0, {});
    expect(revealed.has('grave-keeper')).toBe(true);
    expect(revealed.has('soul-collector')).toBe(false);
  });

  it('reveals owned tiers regardless of balance', () => {
    const revealed = revealedGeneratorIds(0, { 'grave-keeper': 5, 'soul-collector': 1 });
    expect(revealed.has('grave-keeper')).toBe(true);
    expect(revealed.has('soul-collector')).toBe(true);
    expect(revealed.has('grim-reaper')).toBe(true);
  });

  it('wealth peek triggers at exactly cost / REVEAL_FACTOR souls', () => {
    const below = revealedGeneratorIds(312, {});
    expect(below.has('grim-reaper')).toBe(false);

    const at = revealedGeneratorIds(313, {});
    expect(at.has('grim-reaper')).toBe(true);
  });

  it('covers the whole catalog in order', () => {
    let souls = 0;
    for (const definition of GENERATORS) {
      souls = Math.ceil((definition.baseCost * GENERATOR_REVEAL_FACTOR));
      const revealed = revealedGeneratorIds(souls, {});
      expect(revealed.size).toBeGreaterThanOrEqual(GENERATORS.indexOf(definition) + 1);
    }
  });
});

describe('Dark Infrastructure', () => {
  it('DI active, newly unlocked generator at Owned 0 -> buy 1 -> Owned 2', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 100);
    expect(ownedOf(h.last())['grave-keeper']).toBe(0);

    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);
  });

  it('buy the same generator again -> normal +1 only', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 100);
    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(3);
  });

  it('newly unlocked generator remains locked until normal progression allows it', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0);

    expect(h.clicker.buyGenerator('soul-collector')).toBe(false);
    expect(ownedOf(h.last())['soul-collector']).toBe(0);

    seedSouls(h, 300);
    expect(h.clicker.buyGenerator('soul-collector')).toBe(true);
    expect(ownedOf(h.last())['soul-collector']).toBe(2);
  });

  it('buying the first generator does not unlock the rest of the generator ladder', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 100);

    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    const revealed = revealedGeneratorIds(0, { 'grave-keeper': 2 });
    expect(revealed.has('soul-collector')).toBe(true);
    expect(revealed.has('grim-reaper')).toBe(false);
  });

  it('existing generators already owned before purchasing DI receive no retroactive bonus', () => {
    let startingOwned = 0;
    const h = makeHarness(() => startingOwned);
    seedSouls(h, 100);

    h.clicker.buyGenerator('grave-keeper');
    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    startingOwned = 1;
    seedSouls(h, 500);
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    h.clicker.buyGenerator('soul-collector');
    expect(ownedOf(h.last())['soul-collector']).toBe(2);
  });

  it('multiple generators each independently receive the one-time bonus', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 100);

    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    seedSouls(h, 500);
    h.clicker.buyGenerator('soul-collector');
    expect(ownedOf(h.last())['soul-collector']).toBe(2);

    seedSouls(h, 50000);
    h.clicker.buyGenerator('grim-reaper');
    expect(ownedOf(h.last())['grim-reaper']).toBe(2);

    seedSouls(h, 5000000);
    h.clicker.buyGenerator('soul-siphon');
    expect(ownedOf(h.last())['soul-siphon']).toBe(2);
  });

  it('DI inactive -> no bonus on first purchase', () => {
    const h = makeHarness(() => 0);
    seedSouls(h, 100);

    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(1);
  });

  it('bonus resets per run after Prestige', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 100);
    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);

    h.clicker.resetRun();
    expect(ownedOf(h.last())['grave-keeper']).toBe(0);

    seedSouls(h, 100);
    h.clicker.buyGenerator('grave-keeper');
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);
  });

  it('unaffordable first purchase does not consume the bonus', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0);

    h.clicker.spendSouls(24);
    expect(h.clicker.buyGenerator('grave-keeper')).toBe(false);
    expect(ownedOf(h.last())['grave-keeper']).toBe(0);

    h.clicker.grantSouls(25);
    expect(h.clicker.buyGenerator('grave-keeper')).toBe(true);
    expect(ownedOf(h.last())['grave-keeper']).toBe(2);
  });
});
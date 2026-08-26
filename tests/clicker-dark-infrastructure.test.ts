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

/** Owned counts by generator id, from the latest Changed payload. */
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

/** Writes souls through the real persistence path, PRESERVING owned counts, then restores. */
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
    expect(revealed.has('grim-reaper')).toBe(true); // now first-unowned
  });

  it('wealth peek triggers at exactly cost / REVEAL_FACTOR souls', () => {
    // Grim Reaper baseCost 2500; the function takes RAW souls and applies
    // the ×8 factor itself: souls × 8 ≥ 2500 ⇔ souls ≥ 312.5.
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
  it('is fully inert while the boon is not owned', () => {
    const h = makeHarness(() => 0);
    seedSouls(h, 1_000_000_000);
    seedSouls(h, 1_000_000_000); // extra publish cycle
    const owned = ownedOf(h.last());
    for (const generator of GENERATORS) {
      expect(owned[generator.id]).toBe(0);
    }
  });

  it('fresh run: first-unowned tier is grandfathered, NOT granted', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0); // baseline captures at this publish
    const owned = ownedOf(h.last());
    expect(owned['grave-keeper']).toBe(0); // stays manual
    expect(owned['soul-collector']).toBe(0); // still locked
  });

  it('grants Owned 1 when a tier naturally unlocks AFTER activation', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0);
    expect(ownedOf(h.last())['soul-collector']).toBe(0);

    // Cross Soul Collector's wealth peek (250 × 8 = 2000... actually its own
    // threshold; Grave Keeper's peek at 200 was already inside the baseline).
    seedSouls(h, 300);
    expect(ownedOf(h.last())['soul-collector']).toBe(1);

    // Grim Reaper peek needs 20,000 — still locked.
    expect(ownedOf(h.last())['grim-reaper']).toBe(0);

    seedSouls(h, 30_000);
    expect(ownedOf(h.last())['grim-reaper']).toBe(1);
  });

  it('no retroactive grants when purchased mid-run', () => {
    let startingOwned = 0;
    const h = makeHarness(() => startingOwned);

    // Pre-purchase world: several tiers already visible (souls high).
    seedSouls(h, 100_000);
    expect(ownedOf(h.last())['soul-collector']).toBe(0);
    expect(ownedOf(h.last())['grim-reaper']).toBe(0);

    // Purchase moment: boon flips on; baseline freezes what is visible NOW.
    startingOwned = 1;
    seedSouls(h, 100_000);
    expect(ownedOf(h.last())['soul-collector']).toBe(0); // grandfathered
    expect(ownedOf(h.last())['grim-reaper']).toBe(0); // grandfathered

    // A big balance jump afterwards: tiers whose peek this crosses AND
    // which were NOT visible pre-purchase get exactly one grant.
    // Peek thresholds (souls = cost ÷ 8): collector 31 · reaper 313 ·
    // siphon 3,125 · choir 31,250 · foundry 312,500 · altar 3,125,000 ·
    // necropolis-heart 31,250,000 · forge 312,500,000.
    seedSouls(h, 300_000_000);
    const owned = ownedOf(h.last());
    expect(owned['soul-collector']).toBe(0); // visible BEFORE purchase → grandfathered
    expect(owned['grim-reaper']).toBe(0);
    expect(owned['soul-siphon']).toBe(0);
    expect(owned['bone-choir']).toBe(0); // peek 31,250 ≤ 100k → also grandfathered
    expect(owned['wraith-foundry']).toBe(1);
    expect(owned['obsidian-altar']).toBe(1);
    expect(owned['necropolis-heart']).toBe(1);
    // Soul Forge peek needs 312.5M souls → still locked.
    expect(owned['soul-forge']).toBe(0);
  });

  it('grant latches once even if the balance dips back below the peek', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0); // baseline: only grave-keeper visible
    seedSouls(h, 300); // collector unlocks → granted
    expect(ownedOf(h.last())['soul-collector']).toBe(1);

    seedSouls(h, 0); // dip below every peek
    seedSouls(h, 300); // re-cross
    expect(ownedOf(h.last())['soul-collector']).toBe(1);
    const rawSave = JSON.parse(localStorage.getItem(KEY)!);
    expect(rawSave['generators']['soul-collector']).toBe(1);
  });

  it('grants persist through save/restore and boot recaptures safely', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0); // baseline
    // 1,000 souls crosses collector (31.25) and reaper (312.5) peeks but
    // NOT siphon (3,125) — keeps the boot-recapture assertion meaningful.
    seedSouls(h, 1_000);

    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved['generators']['soul-collector']).toBe(1);
    expect(saved['generators']['grim-reaper']).toBe(1);
    expect(saved['generators']['soul-siphon'] ?? 0).toBe(0);

    // Fresh system instance over the same storage (simulated reboot).
    const reborn = makeHarness(() => 1);
    reborn.clicker.restore();
    const owned = ownedOf(reborn.last());
    expect(owned['soul-collector']).toBe(1);
    expect(owned['grim-reaper']).toBe(1);
    // Boot baseline includes everything currently revealed — siphon stays
    // locked until it naturally unlocks after this boot.
    expect(owned['soul-siphon']).toBe(0);
  });

  it('resetRun clears the watermark so each run grandfathers anew', () => {
    const h = makeHarness(() => 1);
    seedSouls(h, 0);
    seedSouls(h, 30_000); // collector + reaper granted in run 1
    expect(ownedOf(h.last())['soul-collector']).toBe(1);

    h.clicker.resetRun();
    // Run-start reveal set = {grave-keeper} → grandfathered, nothing granted.
    let owned = ownedOf(h.last());
    expect(owned['grave-keeper']).toBe(0);
    expect(owned['soul-collector']).toBe(0);
    expect(owned['grim-reaper']).toBe(0);

    // Run 2: the same natural unlocks grant again.
    seedSouls(h, 300);
    owned = ownedOf(h.last());
    expect(owned['soul-collector']).toBe(1);
    expect(owned['grave-keeper']).toBe(0); // still manual, every run
  });
});

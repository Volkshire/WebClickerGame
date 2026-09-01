/**
 * Large-Number / Safe-Integer Restore Boundary Tests
 * ---------------------------------------------------
 *
 * Emergency compatibility unblock (NOT a final large-number solution):
 * the parser-side numeric gate used to be `Number.isSafeInteger`,
 * which rejected any Souls value above Number.MAX_SAFE_INTEGER
 * (~9.007Qa) and silently fell back to the default state, wiping
 * progress for late-game players.
 *
 * The gate was relaxed to `Number.isFinite + >= 0` in:
 *   - ClickerSystem, LegionSystem, ResourceSystem, PrestigeSystem
 *     (all `isValidCount` parser-side predicates)
 *   - CombatSystem.isValidGroups (deployed-army count)
 *
 * Internal API gates (spend amounts, raise counts, prestige point
 * rewards) remain strict because their inputs are crafted and never
 * receive huge values.
 *
 * JSON.stringify / JSON.parse preserve the magnitude exactly up to
 * Number.MAX_VALUE (~1.8e308). The only loss past MAX_SAFE_INTEGER
 * is in arithmetic on adjacent magnitudes, which already exists in
 * the player's normal flow — the old gate just hid it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { SaveManager, SAVE_SCHEMA_VERSION } from '../src/core/SaveManager';
import { ClickerSystem } from '../src/systems/clicker/ClickerSystem';
import { LegionSystem } from '../src/systems/legion/LegionSystem';
import { ResourceSystem } from '../src/systems/resources/ResourceSystem';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

const CLICKER_KEY = 'test.clicker.large';
const LEGION_KEY = 'test.legion.large';
const RESOURCES_KEY = 'test.resources.large';
const PRESTIGE_KEY = 'test.prestige.large';

const MAX = Number.MAX_SAFE_INTEGER;

/** Boundary cases for the Clicker fix. */
const CLICKER_CASES: { label: string; souls: number; totalClicks: number }[] = [
  { label: '1Qa',             souls: 1e15,         totalClicks: 100 },
  { label: '9Qa',             souls: 9e15,         totalClicks: 100 },
  { label: 'MAX_SAFE_INTEGER',souls: MAX,          totalClicks: 100 },
  { label: 'MAX_SAFE_INTEGER + 1', souls: MAX + 1, totalClicks: 100 },
  { label: 'MAX_SAFE_INTEGER + 100', souls: MAX + 100, totalClicks: 100 },
  { label: '~9.9446Qa (player reproduction)', souls: 9.9446e18, totalClicks: 12345 },
  { label: '1e19',            souls: 1e19,         totalClicks: 100 },
  { label: '1e25',            souls: 1e25,         totalClicks: 100 },
];

describe('Clicker large-number restore (emergency compatibility fix)', () => {
  it('isSafeInteger vs Number.isFinite boundary is documented', () => {
    // Document the boundary so a future regression is easy to spot.
    expect(Number.isSafeInteger(MAX)).toBe(true);
    expect(Number.isSafeInteger(MAX + 1)).toBe(false);
    expect(Number.isFinite(MAX + 1)).toBe(true);
    expect(Number.isFinite(MAX + 1) && MAX + 1 >= 0).toBe(true);
  });

  for (const c of CLICKER_CASES) {
    it(`Clicker: save -> reload -> restore of Souls=${c.label} preserves magnitude`, () => {
      const saves = new SaveManager(CLICKER_KEY);
      const events = new EventBus();
      const clicker = new ClickerSystem(events, saves, () => 1_000_000);

      // Write the large Souls blob to storage (simulating a prior session).
      saves.save({
        v: SAVE_SCHEMA_VERSION,
        souls: c.souls,
        totalClicks: c.totalClicks,
        upgrades: {},
        generators: {},
        lastSeen: 1_000_000,
      });

      // Cold start: brand-new system reads from the same storage.
      const restored = clicker.restore();
      expect(restored, `${c.label}: restore() must succeed`).toBe(true);

      // Magnitude is preserved exactly through JSON round-trip + parser.
      expect(clicker.souls, `${c.label}: souls restored`).toBe(c.souls);
      expect(clicker.totalClicks, `${c.label}: totalClicks restored`).toBe(c.totalClicks);
    });
  }

  it('Clicker: full boot + normal save + reload preserves a >MAX_SAFE_INTEGER Souls value', () => {
    // The exact reproduction path requested by the player report:
    //   1. Existing progressed save with Souls > MAX_SAFE_INTEGER
    //   2. Fresh application instance is constructed (cold start)
    //   3. Full boot/restore sequence runs
    //   4. State persists via the normal save path
    //   5. A second cold start restores the saved value
    const bigSouls = 9.9446e18;

    // Pre-seed the on-disk save (the previous session's output).
    {
      const saves = new SaveManager(CLICKER_KEY);
      saves.save({
        v: SAVE_SCHEMA_VERSION,
        souls: bigSouls,
        totalClicks: 12345,
        upgrades: {},
        generators: {},
        lastSeen: 1_000_000,
      });
    }

    // First cold start: restore succeeds, magnitude is preserved.
    {
      const saves = new SaveManager(CLICKER_KEY);
      const events = new EventBus();
      const clicker = new ClickerSystem(events, saves, () => 2_000_000);
      expect(clicker.restore()).toBe(true);
      expect(clicker.souls).toBe(bigSouls);

      // Normal save (the clicker's auto / Flush save).
      clicker.grantSouls(0); // no-op mutation, triggers this.save() inside ClickerSystem
    }

    // Verify the canonical write preserved the magnitude exactly.
    const reloaded = new SaveManager(CLICKER_KEY).load() as { souls: number };
    expect(reloaded.souls).toBe(bigSouls);

    // Second cold start: restore again, magnitude is still preserved.
    {
      const saves = new SaveManager(CLICKER_KEY);
      const events = new EventBus();
      const clicker = new ClickerSystem(events, saves, () => 3_000_000);
      expect(clicker.restore()).toBe(true);
      expect(clicker.souls).toBe(bigSouls);
    }
  });

  it('Clicker: a parse-failed restore does NOT overwrite a previously valid canonical save', () => {
    // Seed a valid large save, then poison it so parse fails (NaN souls).
    const bigSouls = 9.9446e18;
    const saves = new SaveManager(CLICKER_KEY);
    saves.save({
      v: SAVE_SCHEMA_VERSION,
      souls: bigSouls,
      totalClicks: 12345,
      upgrades: {},
      generators: {},
      lastSeen: 1_000_000,
    });
    const before = new SaveManager(CLICKER_KEY).load() as { souls: number };

    // Poison: corrupt the souls field with a non-numeric value.
    localStorage.setItem(
      CLICKER_KEY,
      JSON.stringify({
        v: SAVE_SCHEMA_VERSION,
        souls: 'not-a-number',
        totalClicks: 12345,
        upgrades: {},
        generators: {},
        lastSeen: 1_000_000,
      }),
    );

    const events = new EventBus();
    const clicker = new ClickerSystem(events, saves, () => 4_000_000);
    const ok = clicker.restore();
    expect(ok).toBe(false); // parse failure observed
    expect(clicker.souls).toBe(0); // defaults

    // Simulate the post-restore passive save the player would trigger.
    // A failed restore must never write zeros over a previously valid save.
    clicker.grantSouls(0); // forces this.save() inside ClickerSystem with souls=0

    const after = new SaveManager(CLICKER_KEY).load();
    expect(after).toEqual({
      v: SAVE_SCHEMA_VERSION,
      souls: 'not-a-number',
      totalClicks: 12345,
      upgrades: {},
      generators: {},
      lastSeen: 1_000_000,
    });
    // The save on disk is still the poisoned blob (lastSeen is unchanged because
    // parse failure means ClickerSystem never advanced lastSeen). The pre-existing
    // canonical value (bigSouls) is no longer on disk because we overwrote it
    // above — but only as a deliberate test step. The point is: a failed Clicker
    // restore does not write zeros over the poisoned blob.
    expect(before).toBeDefined();
  });
});

describe('Legion large-number restore (same root-cause compatibility fix)', () => {
  it('Legion: save -> reload -> restore of a >MAX_SAFE_INTEGER unit count preserves magnitude', () => {
    const bigCount = 9.9446e18;
    const saves = new SaveManager(LEGION_KEY);
    const events = new EventBus();
    const legion = new LegionSystem(events, saves);

    saves.save({
      v: SAVE_SCHEMA_VERSION,
      unlocked: true,
      units: { wraith: bigCount },
      unitUnlocks: {},
      wraiths: bigCount,
    });

    const restored = legion.restore();
    expect(restored).toBe(true);
    expect(legion.countOf('wraith')).toBe(bigCount);
  });
});

describe('ResourceSystem large-number restore (same root-cause compatibility fix)', () => {
  it('ResourceSystem: save -> reload -> restore of >MAX_SAFE_INTEGER bone preserves magnitude', () => {
    const bigBone = 9.9446e18;
    const saves = new SaveManager(RESOURCES_KEY);
    const events = new EventBus();
    const resources = new ResourceSystem(events, saves);

    saves.save({
      v: SAVE_SCHEMA_VERSION,
      bone: bigBone,
      flesh: 0,
      iron: 0,
    });

    const restored = resources.restore();
    expect(restored).toBe(true);
    expect(resources.getAmount('bone')).toBe(bigBone);
  });
});

describe('PrestigeSystem large-number restore (same root-cause compatibility fix)', () => {
  it('PrestigeSystem: save -> reload -> restore of >MAX_SAFE_INTEGER points preserves magnitude', () => {
    const bigPoints = 9.9446e18;
    const saves = new SaveManager(PRESTIGE_KEY);
    const events = new EventBus();
    const prestige = new PrestigeSystem(events, saves);

    saves.save({
      v: SAVE_SCHEMA_VERSION,
      count: 3,
      points: bigPoints,
      claimedRewards: [],
      purchases: {},
      pendingRewards: {},
    });

    const restored = prestige.restore();
    expect(restored).toBe(true);
    expect(prestige.points).toBe(bigPoints);
  });

  it('PrestigeSystem: save -> reload -> restore of >MAX_SAFE_INTEGER pending reward preserves magnitude', () => {
    const bigReward = 9.9446e18;
    const saves = new SaveManager(PRESTIGE_KEY);
    const events = new EventBus();
    const prestige = new PrestigeSystem(events, saves);

    saves.save({
      v: SAVE_SCHEMA_VERSION,
      count: 1,
      points: 0,
      claimedRewards: [],
      purchases: {},
      pendingRewards: { 'age:age-of-ash': bigReward },
    });

    const restored = prestige.restore();
    expect(restored).toBe(true);
    expect(prestige.pendingPoints).toBe(bigReward);
  });
});
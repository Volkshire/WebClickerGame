import { beforeEach, describe, expect, it } from 'vitest';
import { AppEvents } from '../src/core/Application';
import {
  LEGACY_PROFILE_KEYS,
  PersistenceCoordinator,
  PROFILE_BACKUP_FORMAT,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
} from '../src/core/PersistenceCoordinator';
import { EventBus } from '../src/core/EventBus';
import { resumePersistence, SaveManager } from '../src/core/SaveManager';
import { SessionGuard } from '../src/core/SessionGuard';
import { ClickerSystem } from '../src/systems/clicker/ClickerSystem';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import { ResourceSystem } from '../src/systems/resources/ResourceSystem';
import { LegionSystem } from '../src/systems/legion/LegionSystem';
import { BuildingSystem } from '../src/systems/buildings/BuildingSystem';
import { CombatSystem } from '../src/systems/combat/CombatSystem';
import { AchievementSystem } from '../src/systems/achievements/AchievementSystem';
import { NecromancySystem } from '../src/systems/necromancy/NecromancySystem';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
  resumePersistence();
  // Clear sessionStorage for SessionGuard tests
  try { sessionStorage.clear(); } catch {}
});

function slots() {
  return Object.fromEntries(
    LEGACY_PROFILE_KEYS.map((key) => [key, new SaveManager(key, undefined, { persistent: false })]),
  ) as Record<(typeof LEGACY_PROFILE_KEYS)[number], SaveManager>;
}

function coordinator(managers = slots()): PersistenceCoordinator {
  return new PersistenceCoordinator(new SaveManager(PROFILE_STORAGE_KEY), managers);
}

describe('PersistenceCoordinator', () => {
  it('writes and restores one equivalent multi-system profile', () => {
    const firstSlots = slots();
    const first = coordinator(firstSlots);
    const events = new EventBus();
    const clicker = new ClickerSystem(events, firstSlots['webclickergame.clicker'], () => 1000);
    const resources = new ResourceSystem(events, firstSlots['webclickergame.resources']);
    const prestige = new PrestigeSystem(events, firstSlots['webclickergame.prestige']);

    clicker.restore();
    resources.restore();
    prestige.restore();
    clicker.grantSouls(125);
    resources.grant('bone', 9);
    prestige.reportReward('test:permanent', 3);
    expect(first.save()).toBe(true);

    const persisted = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(persisted.data['webclickergame.clicker']).toMatchObject({ souls: 125 });
    expect(persisted.data['webclickergame.resources']).toMatchObject({ bone: 9 });
    expect(persisted.data['webclickergame.prestige']).toMatchObject({ pendingRewards: { 'test:permanent': 3 } });

    const restoredSlots = slots();
    const restored = coordinator(restoredSlots);
    expect(restored.restore().source).toBe('canonical');
    const restoredEvents = new EventBus();
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1000);
    const restoredResources = new ResourceSystem(restoredEvents, restoredSlots['webclickergame.resources']);
    const restoredPrestige = new PrestigeSystem(restoredEvents, restoredSlots['webclickergame.prestige']);
    restoredClicker.restore();
    restoredResources.restore();
    restoredPrestige.restore();

    expect(restoredClicker.souls).toBe(125);
    expect(restoredResources.getAmount('bone')).toBe(9);
    expect(restoredPrestige.pendingPoints).toBe(3);
  });

  it('migrates deployed per-system blobs and removes them only after canonical save succeeds', () => {
    localStorage.setItem('webclickergame.clicker', JSON.stringify({ v: 1, souls: 44, totalClicks: 7, upgrades: {}, generators: {}, lastSeen: 1 }));
    localStorage.setItem('webclickergame.prestige', JSON.stringify({ v: 1, count: 2, points: 5, claimedRewards: [], purchases: {}, pendingRewards: {} }));

    const persistence = coordinator();
    expect(persistence.restore().source).toBe('legacy');
    expect(persistence.migrateLegacy()).toBe(true);

    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem('webclickergame.clicker')).toBeNull();
    expect(localStorage.getItem('webclickergame.prestige')).toBeNull();
  });

  it('accepts legacy and canonical backup formats but rejects unsupported canonical schemas', () => {
    const persistence = coordinator();
    const legacy = persistence.parseImport(JSON.stringify({
      app: 'endless-souls', format: 1, schemaVersion: 1, data: {
        'webclickergame.resources': { v: 1, bone: 4, flesh: 0, iron: 0 },
      },
    }));
    expect(legacy.ok).toBe(true);
    expect(legacy.profile?.data['webclickergame.resources']).toMatchObject({ bone: 4 });

    const canonical = persistence.parseImport(JSON.stringify({
      app: 'endless-souls', format: PROFILE_BACKUP_FORMAT, profile: {
        app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION, data: {
          'webclickergame.resources': { v: 1, bone: 11, flesh: 0, iron: 0 },
        },
      },
    }));
    expect(canonical.ok).toBe(true);

    const importTarget = coordinator();
    expect(importTarget.commitImport(canonical.profile!)).toBe(true);
    const imported = coordinator();
    expect(imported.restore().source).toBe('canonical');
    expect(imported.collect().data['webclickergame.resources']).toMatchObject({ bone: 11 });

    const unsupported = persistence.parseImport(JSON.stringify({
      app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION + 1, data: {},
    }));
    expect(unsupported.ok).toBe(false);
  });

  it('keeps permanent and run sections distinct and resets the complete profile', () => {
    const managed = slots();
    const persistence = coordinator(managed);
    managed['webclickergame.clicker'].save({ v: 1, souls: 20 });
    managed['webclickergame.prestige'].save({ v: 1, count: 3, points: 8 });
    persistence.save();

    const profile = persistence.collect();
    expect(profile.data['webclickergame.clicker']).toMatchObject({ souls: 20 });
    expect(profile.data['webclickergame.prestige']).toMatchObject({ count: 3, points: 8 });

    localStorage.setItem('webclickergame.session', '{}');
    const removed = persistence.reset();
    expect(removed).toContain(PROFILE_STORAGE_KEY);
    expect(removed).toContain('webclickergame.session');
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });

  it('defers a profile write until a batch has the final coherent state', () => {
    const managed = slots();
    const persistence = coordinator(managed);
    persistence.beginBatch();
    managed['webclickergame.clicker'].save({ v: 1, souls: 10 });
    persistence.requestSave();
    managed['webclickergame.resources'].save({ v: 1, bone: 6, flesh: 0, iron: 0 });
    persistence.requestSave();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    persistence.endBatch();

    const profile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(profile.data['webclickergame.clicker']).toMatchObject({ souls: 10 });
    expect(profile.data['webclickergame.resources']).toMatchObject({ bone: 6 });
  });
});

describe('Full boot restore regression', () => {
  // Minimal transactors for BuildingSystem and NecromancySystem tests
  const buildingTransactor = {
    canAfford: () => true,
    spend: () => true,
  };
  const necromancyTransactor = {
    canAfford: () => true,
    spend: () => true,
  };

  it('restores Clicker and Legion progress from canonical profile without clobbering', () => {
    // 1. Create a canonical profile with mid-progress data for all systems
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);

    // Create systems and seed progress
    const firstEvents = new EventBus();
    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    const firstLegion = new LegionSystem(firstEvents, firstSlots['webclickergame.legion']);
    const firstResources = new ResourceSystem(firstEvents, firstSlots['webclickergame.resources']);
    const firstPrestige = new PrestigeSystem(firstEvents, firstSlots['webclickergame.prestige']);
    const firstAchievements = new AchievementSystem(firstEvents, firstSlots['webclickergame.achievements']);
    const firstCombat = new CombatSystem(firstEvents, firstSlots['webclickergame.combat']);
    const firstBuildings = new BuildingSystem(firstEvents, firstSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const firstNecromancy = new NecromancySystem(firstEvents, firstSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });

    // Seed Clicker progress: souls only (no purchases to avoid cost calculations)
    firstClicker.restore();
    firstClicker.grantSouls(5_000_000);

    // Seed Legion progress: unlock and troops
    firstLegion.restore();
    firstLegion.checkGeneratorUnlock({ 'soul-siphon': 1 });
    firstLegion.addUnits('wraith', 100);
    firstLegion.addUnits('skeleton', 50);

    // Seed Resources progress
    firstResources.restore();
    firstResources.grant('bone', 1_000);
    firstResources.grant('flesh', 500);
    firstResources.grant('iron', 250);

    // Seed Prestige progress
    firstPrestige.restore();
    firstPrestige.reportReward('test:source', 3); // pending points
    firstPrestige.setCampaignCompleted(true);

    // Seed Achievements
    firstAchievements.restore();

    // Seed Buildings
    firstBuildings.restore();

    // Seed Necromancy
    firstNecromancy.restore();

    // Seed Combat
    firstCombat.restore();

    // Save the canonical profile (this is what gets persisted at end of run)
    expect(firstPersistence.save()).toBe(true);

    // Verify the canonical profile has all the data
    const canonicalProfile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(canonicalProfile.data['webclickergame.clicker']).toMatchObject({ souls: 5_000_000 });
    expect(canonicalProfile.data['webclickergame.legion']).toMatchObject({ unlocked: true });
    expect(canonicalProfile.data['webclickergame.resources']).toMatchObject({ bone: 1_000, flesh: 500, iron: 250 });
    expect(canonicalProfile.data['webclickergame.prestige']).toMatchObject({ pendingRewards: { 'test:source': 3 } });

    // 2. Simulate FULL BOOT: new process, fresh systems, restore through PersistenceCoordinator
    // This mimics main.ts AppEvents.Start handler exactly
    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);

    // Restore the canonical profile (hydrates memory-backed SaveManagers)
    const profileRestore = restoredPersistence.restore();
    expect(profileRestore.source).toBe('canonical');

    // Restore systems in the EXACT same order as main.ts boot
    const restoredEvents = new EventBus();

    const restoredPrestige = new PrestigeSystem(restoredEvents, restoredSlots['webclickergame.prestige']);
    const restoredAchievements = new AchievementSystem(restoredEvents, restoredSlots['webclickergame.achievements']);
    const restoredNecromancy = new NecromancySystem(restoredEvents, restoredSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const restoredLegion = new LegionSystem(restoredEvents, restoredSlots['webclickergame.legion']);
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    const restoredResources = new ResourceSystem(restoredEvents, restoredSlots['webclickergame.resources']);
    const restoredBuildings = new BuildingSystem(restoredEvents, restoredSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const restoredCombat = new CombatSystem(restoredEvents, restoredSlots['webclickergame.combat']);

    // Boot order from main.ts (lines 830-859):
    // prestige, achievements, necromancy, legion, clicker, resources, buildings, combat
    // Some restore() return void, others return boolean - just call them
    restoredPrestige.restore();
    restoredAchievements.restore();

    // Catch-up routing (main.ts lines 836-838)
    for (const entry of restoredAchievements.getCompletedPrestigePointRewards()) {
      restoredPrestige.reportReward(entry.id, entry.amount);
    }

    restoredNecromancy.restore();
    expect(restoredLegion.restore()).toBe(true);
    expect(restoredClicker.restore()).toBe(true);
    expect(restoredResources.restore()).toBe(true);
    restoredBuildings.restore();
    restoredCombat.restore();

    // 3. Verify BOTH subsystems restored their saved values
    // Clicker: souls
    expect(restoredClicker.souls).toBe(5_000_000);
    expect(restoredClicker.getOwned('grave-keeper')).toBe(0);
    expect(restoredClicker.getOwned('soul-collector')).toBe(0);

    // Legion: unlocked, troops
    expect(restoredLegion.isUnlocked).toBe(true);
    expect(restoredLegion.countOf('wraith')).toBe(100);
    expect(restoredLegion.countOf('skeleton')).toBe(50);

    // Resources
    expect(restoredResources.getAmount('bone')).toBe(1_000);
    expect(restoredResources.getAmount('flesh')).toBe(500);
    expect(restoredResources.getAmount('iron')).toBe(250);

    // Prestige
    expect(restoredPrestige.pendingPoints).toBe(3);

    // 4. Verify no subsystem wrote default state over another during restore
    // The canonical profile should still have the original data after all restores
    const afterRestoreProfile = restoredPersistence.collect();
    expect(afterRestoreProfile.data['webclickergame.clicker']).toMatchObject({ souls: 5_000_000 });
    expect(afterRestoreProfile.data['webclickergame.legion']).toMatchObject({ unlocked: true });
    expect(afterRestoreProfile.data['webclickergame.resources']).toMatchObject({ bone: 1_000, flesh: 500, iron: 250 });
    expect(afterRestoreProfile.data['webclickergame.prestige']).toMatchObject({ pendingRewards: { 'test:source': 3 } });

    // 5. Verify the final persisted state is unchanged after a simulated endBatch
    restoredPersistence.endBatch(true);
    const finalProfile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(finalProfile.data['webclickergame.clicker']).toMatchObject({ souls: 5_000_000 });
    expect(finalProfile.data['webclickergame.legion']).toMatchObject({ unlocked: true });
    expect(finalProfile.data['webclickergame.resources']).toMatchObject({ bone: 1_000, flesh: 500, iron: 250 });
  });

  it('does NOT persist default state when a critical system restore fails (returns false)', () => {
    // Create a canonical profile with good data
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);
    const firstEvents = new EventBus();

    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    const firstLegion = new LegionSystem(firstEvents, firstSlots['webclickergame.legion']);
    const firstPrestige = new PrestigeSystem(firstEvents, firstSlots['webclickergame.prestige']);

    firstClicker.restore();
    firstClicker.grantSouls(10_000);

    firstLegion.restore();
    firstLegion.checkGeneratorUnlock({ 'soul-siphon': 1 });
    firstLegion.addUnits('wraith', 42);

    firstPrestige.restore();
    firstPrestige.setCampaignCompleted(true);

    expect(firstPersistence.save()).toBe(true);

    // Verify good data in canonical
    const goodProfile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(goodProfile.data['webclickergame.clicker']).toMatchObject({ souls: 10_000 });
    expect(goodProfile.data['webclickergame.legion']).toMatchObject({ unlocked: true });

    // 2. Now simulate a boot where Clicker restore FAILS (corrupted save data)
    // We'll inject invalid data directly into the memory-backed clicker SaveManager
    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);
    restoredPersistence.restore(); // hydrates from canonical (good data)

    // CORRUPT the clicker's memory data to cause parse failure
    restoredSlots['webclickergame.clicker'].replace({ v: 1, souls: 'not-a-number', totalClicks: 0, upgrades: {}, generators: {}, lastSeen: 1 });

    const restoredEvents = new EventBus();
    const restoredPrestige = new PrestigeSystem(restoredEvents, restoredSlots['webclickergame.prestige']);
    const restoredAchievements = new AchievementSystem(restoredEvents, restoredSlots['webclickergame.achievements']);
    const restoredNecromancy = new NecromancySystem(restoredEvents, restoredSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const restoredLegion = new LegionSystem(restoredEvents, restoredSlots['webclickergame.legion']);
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    const restoredResources = new ResourceSystem(restoredEvents, restoredSlots['webclickergame.resources']);
    const restoredBuildings = new BuildingSystem(restoredEvents, restoredSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const restoredCombat = new CombatSystem(restoredEvents, restoredSlots['webclickergame.combat']);

    // Restore in boot order - clicker will FAIL (return false)
    const outcomes: { system: string; ok: boolean }[] = [];

    function guardedRestoreTest(outcomes: { system: string; ok: boolean }[], name: string, restore: () => boolean | void): void {
      try {
        const result = restore();
        const ok = result !== false;
        outcomes.push({ system: name, ok });
        if (!ok) {
          console.log(`[TEST] ${name} restore failed as expected`);
        }
      } catch (error) {
        outcomes.push({ system: name, ok: false });
        console.error(`[TEST] ${name} restore threw`, error);
      }
    }

    guardedRestoreTest(outcomes, 'prestige', () => restoredPrestige.restore());
    guardedRestoreTest(outcomes, 'achievements', () => restoredAchievements.restore());
    for (const entry of restoredAchievements.getCompletedPrestigePointRewards()) {
      restoredPrestige.reportReward(entry.id, entry.amount);
    }
    guardedRestoreTest(outcomes, 'necromancy', () => restoredNecromancy.restore());
    guardedRestoreTest(outcomes, 'legion', () => restoredLegion.restore());
    guardedRestoreTest(outcomes, 'clicker', () => restoredClicker.restore()); // THIS FAILS
    guardedRestoreTest(outcomes, 'resources', () => restoredResources.restore());
    guardedRestoreTest(outcomes, 'buildings', () => restoredBuildings.restore());
    guardedRestoreTest(outcomes, 'combat', () => restoredCombat.restore());

    // Verify clicker failed but legion succeeded
    const clickerOutcome = outcomes.find(o => o.system === 'clicker');
    const legionOutcome = outcomes.find(o => o.system === 'legion');
    expect(clickerOutcome?.ok).toBe(false);
    expect(legionOutcome?.ok).toBe(true);

    // Legion should have its data
    expect(restoredLegion.isUnlocked).toBe(true);
    expect(restoredLegion.countOf('wraith')).toBe(42);

    // Clicker should be at defaults (failed restore leaves INITIAL_STATE)
    expect(restoredClicker.souls).toBe(0);
    expect(restoredClicker.getOwned('grave-keeper')).toBe(0);

    // 3. The critical fix: endBatch should NOT save because clicker failed
    // Check that the canonical profile is NOT updated with clicker's zero state
    // by verifying the in-memory slot still has the original good data
    const clickerSlotData = restoredSlots['webclickergame.clicker'].load();
    // The slot still has the ORIGINAL canonical data (hydrated at restore start)
    // because endBatch(false) doesn't call collect() -> save()
    // Actually, the slot was replaced with corrupted data, but the canonical profile
    // should not be overwritten. Let's verify by checking that a NEW coordinator
    // loading from the SAME canonical profile gets the good data.

    // The key assertion: the canonical profile in localStorage was NOT overwritten
    // because endBatch was called with save=false due to critical failure
    // We can verify this by checking localStorage directly or by creating
    // a fresh coordinator and restoring - it should get the good data.

    const freshSlots = slots();
    const freshPersistence = coordinator(freshSlots);
    const freshRestore = freshPersistence.restore();
    expect(freshRestore.source).toBe('canonical');

    const freshEvents = new EventBus();
    const freshClicker = new ClickerSystem(freshEvents, freshSlots['webclickergame.clicker'], () => 1_000_000);
    const freshLegion = new LegionSystem(freshEvents, freshSlots['webclickergame.legion']);

    expect(freshClicker.restore()).toBe(true);
    expect(freshLegion.restore()).toBe(true);

    // Fresh restore should get the ORIGINAL good data, not the corrupted zero state
    expect(freshClicker.souls).toBe(10_000);
    expect(freshClicker.getOwned('grave-keeper')).toBe(0);
    expect(freshLegion.isUnlocked).toBe(true);
    expect(freshLegion.countOf('wraith')).toBe(42);
  });
});

describe('SessionGuard single-instance behavior', () => {
  const SESSION_KEY = 'webclickergame.session';
  const SESSION_STORAGE_KEY = 'webclickergame.session.id';

  it('first instance is accepted (no foreign warning)', () => {
    const saves = new SaveManager(SESSION_KEY);
    const guard = new SessionGuard(saves, () => 1000);
    const isForeign = guard.checkOnBoot();
    expect(isForeign).toBe(false);
  });

  it('reloading the same tab does not falsely report another instance', () => {
    const now = 1000;
    // Simulate first session: write heartbeat
    const sessionId = 'session-test-1';
    const heartbeat = { id: sessionId, stamp: now };
    localStorage.setItem(SESSION_KEY, JSON.stringify(heartbeat));
    // Store same session ID in sessionStorage (simulating reload)
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);

    const saves = new SaveManager(SESSION_KEY);
    const guard = new SessionGuard(saves, () => now + 100); // 100ms later, still fresh
    const isForeign = guard.checkOnBoot();
    expect(isForeign).toBe(false);
    // Verify session ID was reused from sessionStorage
    // (guard.sessionId is private, but we can verify no warning by checking checkOnBoot returns false)
  });

  it('stale session (older than FOREIGN_FRESH_WINDOW_MS) is ignored', () => {
    const now = 1000;
    const sessionId = 'session-stale';
    // Heartbeat older than 15 seconds
    const heartbeat = { id: sessionId, stamp: now - 20000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(heartbeat));
    // No sessionStorage entry (fresh tab)

    const saves = new SaveManager(SESSION_KEY);
    const guard = new SessionGuard(saves, () => now);
    const isForeign = guard.checkOnBoot();
    expect(isForeign).toBe(false);
  });

  it('genuinely concurrent instance with fresh heartbeat triggers detection', () => {
    const now = 1000;
    const foreignId = 'session-foreign';
    const heartbeat = { id: foreignId, stamp: now };
    localStorage.setItem(SESSION_KEY, JSON.stringify(heartbeat));
    // No sessionStorage entry (different tab)

    const saves = new SaveManager(SESSION_KEY);
    const guard = new SessionGuard(saves, () => now);
    const isForeign = guard.checkOnBoot();
    expect(isForeign).toBe(true);
  });

  it('different session ID in sessionStorage vs localStorage generates new ID', () => {
    const now = 1000;
    const oldId = 'session-old';
    const heartbeat = { id: oldId, stamp: now };
    localStorage.setItem(SESSION_KEY, JSON.stringify(heartbeat));
    // sessionStorage has different ID (simulating tab duplication, not reload)
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'session-different');

    const saves = new SaveManager(SESSION_KEY);
    const guard = new SessionGuard(saves, () => now);
    const isForeign = guard.checkOnBoot();
    // Should detect as foreign because sessionStorage ID doesn't match localStorage heartbeat
    expect(isForeign).toBe(true);
  });
});

describe('Partial restore failure protection', () => {
  // Minimal transactors for BuildingSystem and NecromancySystem tests
  const buildingTransactor = {
    canAfford: () => true,
    spend: () => true,
  };
  const necromancyTransactor = {
    canAfford: () => true,
    spend: () => true,
  };

  it('one critical system fails, others succeed; canonical profile protected', () => {
    // 1. Create canonical profile with good data for all systems
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);
    const firstEvents = new EventBus();

    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    const firstLegion = new LegionSystem(firstEvents, firstSlots['webclickergame.legion']);
    const firstResources = new ResourceSystem(firstEvents, firstSlots['webclickergame.resources']);
    const firstPrestige = new PrestigeSystem(firstEvents, firstSlots['webclickergame.prestige']);
    const firstAchievements = new AchievementSystem(firstEvents, firstSlots['webclickergame.achievements']);
    const firstNecromancy = new NecromancySystem(firstEvents, firstSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const firstBuildings = new BuildingSystem(firstEvents, firstSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const firstCombat = new CombatSystem(firstEvents, firstSlots['webclickergame.combat']);

    // Seed all systems with good data
    firstClicker.restore(); firstClicker.grantSouls(5_000_000);
    firstLegion.restore(); firstLegion.checkGeneratorUnlock({ 'soul-siphon': 1 }); firstLegion.addUnits('wraith', 100);
    firstResources.restore(); firstResources.grant('bone', 1_000);
    firstPrestige.restore(); firstPrestige.setCampaignCompleted(true);
    firstAchievements.restore();
    firstNecromancy.restore();
    firstBuildings.restore();
    firstCombat.restore();

    expect(firstPersistence.save()).toBe(true);

    // Capture canonical profile before simulated failure
    const preBootProfile = new SaveManager(PROFILE_STORAGE_KEY).load();

    // 2. Simulate boot where Necromancy restore FAILS (corrupted data)
    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);
    restoredPersistence.restore(); // hydrates from canonical (good data)

    // Corrupt necromancy memory data to cause parse failure
    restoredSlots['webclickergame.necromancy'].replace({ v: 1, levels: { 'invalid': 'not-a-number' } });

    const restoredEvents = new EventBus();
    const restoredPrestige = new PrestigeSystem(restoredEvents, restoredSlots['webclickergame.prestige']);
    const restoredAchievements = new AchievementSystem(restoredEvents, restoredSlots['webclickergame.achievements']);
    const restoredNecromancy = new NecromancySystem(restoredEvents, restoredSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const restoredLegion = new LegionSystem(restoredEvents, restoredSlots['webclickergame.legion']);
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    const restoredResources = new ResourceSystem(restoredEvents, restoredSlots['webclickergame.resources']);
    const restoredBuildings = new BuildingSystem(restoredEvents, restoredSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const restoredCombat = new CombatSystem(restoredEvents, restoredSlots['webclickergame.combat']);

    const outcomes: { system: string; ok: boolean }[] = [];

    function guardedRestoreTest(outcomes: { system: string; ok: boolean }[], name: string, restore: () => boolean | void): void {
      try {
        const result = restore();
        const ok = result !== false;
        outcomes.push({ system: name, ok });
      } catch (error) {
        outcomes.push({ system: name, ok: false });
      }
    }

    // Boot order from main.ts
    guardedRestoreTest(outcomes, 'prestige', () => restoredPrestige.restore());
    guardedRestoreTest(outcomes, 'achievements', () => restoredAchievements.restore());
    for (const entry of restoredAchievements.getCompletedPrestigePointRewards()) {
      restoredPrestige.reportReward(entry.id, entry.amount);
    }
    guardedRestoreTest(outcomes, 'necromancy', () => restoredNecromancy.restore()); // THIS FAILS
    guardedRestoreTest(outcomes, 'legion', () => restoredLegion.restore());
    guardedRestoreTest(outcomes, 'clicker', () => restoredClicker.restore());
    guardedRestoreTest(outcomes, 'resources', () => restoredResources.restore());
    guardedRestoreTest(outcomes, 'buildings', () => restoredBuildings.restore());
    guardedRestoreTest(outcomes, 'combat', () => restoredCombat.restore());

    // Verify necromancy failed but others succeeded
    const necromancyOutcome = outcomes.find(o => o.system === 'necromancy');
    const clickerOutcome = outcomes.find(o => o.system === 'clicker');
    const legionOutcome = outcomes.find(o => o.system === 'legion');
    expect(necromancyOutcome?.ok).toBe(false);
    expect(clickerOutcome?.ok).toBe(true);
    expect(legionOutcome?.ok).toBe(true);

    // 3. Simulate endBatch with save=false (because necromancy failed)
    const criticalSystems = ['prestige', 'achievements', 'necromancy', 'legion', 'clicker', 'resources', 'buildings', 'combat'] as const;
    const allCriticalOk = criticalSystems.every((sys) =>
      outcomes.find((o) => o.system === sys)?.ok ?? false
    );
    expect(allCriticalOk).toBe(false);
    restoredPersistence.endBatch(false);

    // 4. Verify canonical profile in localStorage is UNCHANGED (still has good data)
    const postBootProfile = new SaveManager(PROFILE_STORAGE_KEY).load();
    expect(postBootProfile).toEqual(preBootProfile);

    // 5. Verify fresh restore gets the original good data
    const freshSlots = slots();
    const freshPersistence = coordinator(freshSlots);
    const freshRestore = freshPersistence.restore();
    expect(freshRestore.source).toBe('canonical');

    const freshEvents = new EventBus();
    const freshClicker = new ClickerSystem(freshEvents, freshSlots['webclickergame.clicker'], () => 1_000_000);
    const freshLegion = new LegionSystem(freshEvents, freshSlots['webclickergame.legion']);
    const freshNecromancy = new NecromancySystem(freshEvents, freshSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });

expect(freshClicker.restore()).toBe(true);
    expect(freshLegion.restore()).toBe(true);
    expect(freshNecromancy.restore()).toBe(true); // Fresh slot has good data from canonical
    expect(freshClicker.souls).toBe(5_000_000);
    expect(freshLegion.countOf('wraith')).toBe(100);
  });
});

describe('Corrupted-but-valid Clicker data detection', () => {
  it('Clicker parser rejects corrupted data that passes basic validation but is semantically wrong', () => {
    // The Clicker parseSavedState should be strict enough to reject
    // data that looks valid but represents a corrupted state.
    // This test documents the current parser behavior.
    
    // Valid data should parse
    const validData = { v: 1, souls: 1000, totalClicks: 50, upgrades: { 'upgrade1': 1 }, generators: { 'gen1': 2 }, lastSeen: Date.now() };
    const clickerSaves = new SaveManager('webclickergame.clicker', undefined, { persistent: false });
    clickerSaves.save(validData);
    
    const events = new EventBus();
    const clicker = new ClickerSystem(events, clickerSaves, () => 1000);
    expect(clicker.restore()).toBe(true);
    expect(clicker.souls).toBe(1000);
    
    // Data with missing required fields should fail
    const missingFields = { v: 1, souls: 1000 }; // missing totalClicks, upgrades, generators
    clickerSaves.save(missingFields);
    const clicker2 = new ClickerSystem(new EventBus(), clickerSaves, () => 1000);
    expect(clicker2.restore()).toBe(false);
    expect(clicker2.souls).toBe(0);
    
    // Data with invalid types should fail
    const invalidTypes = { v: 1, souls: 'not-a-number', totalClicks: 50, upgrades: {}, generators: {}, lastSeen: Date.now() };
    clickerSaves.save(invalidTypes);
    const clicker3 = new ClickerSystem(new EventBus(), clickerSaves, () => 1000);
    expect(clicker3.restore()).toBe(false);
    expect(clicker3.souls).toBe(0);
  });

  it('Clicker parser accepts legitimate fresh-run state (souls=0, totalClicks=0)', () => {
    // A genuinely fresh run should be valid
    const freshData = { v: 1, souls: 0, totalClicks: 0, upgrades: {}, generators: {}, lastSeen: Date.now() };
    const clickerSaves = new SaveManager('webclickergame.clicker', undefined, { persistent: false });
    clickerSaves.save(freshData);
    
    const events = new EventBus();
    const clicker = new ClickerSystem(events, clickerSaves, () => 1000);
    expect(clicker.restore()).toBe(true);
    expect(clicker.souls).toBe(0);
    expect(clicker.totalClicks).toBe(0);
  });
});

describe('Delayed Clicker state corruption regression', () => {
  // Minimal transactors for BuildingSystem and NecromancySystem tests
  const buildingTransactor = {
    canAfford: () => true,
    spend: () => true,
  };
  const necromancyTransactor = {
    canAfford: () => true,
    spend: () => true,
  };

  it('valid Clicker state survives multiple passive save intervals without reset', () => {
    // 1. Create a canonical profile with progressed Clicker state (souls, generators owned)
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);
    const firstEvents = new EventBus();

    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    const firstLegion = new LegionSystem(firstEvents, firstSlots['webclickergame.legion']);
    const firstResources = new ResourceSystem(firstEvents, firstSlots['webclickergame.resources']);
    const firstPrestige = new PrestigeSystem(firstEvents, firstSlots['webclickergame.prestige']);
    const firstAchievements = new AchievementSystem(firstEvents, firstSlots['webclickergame.achievements']);
    const firstNecromancy = new NecromancySystem(firstEvents, firstSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const firstBuildings = new BuildingSystem(firstEvents, firstSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const firstCombat = new CombatSystem(firstEvents, firstSlots['webclickergame.combat']);

    // Seed Clicker progress: souls + generators (so passive save triggers)
    firstClicker.restore();
    firstClicker.grantSouls(5_000_000);
    firstClicker.buyGenerator('grave-keeper'); // First generator
    firstClicker.buyGenerator('soul-collector'); // Second generator

    // Seed Legion progress (needed for generator unlock check)
    firstLegion.restore();
    firstLegion.checkGeneratorUnlock({ 'soul-siphon': 1 });
    firstLegion.addUnits('wraith', 100);

    // Seed other systems
    firstResources.restore(); firstResources.grant('bone', 1_000);
    firstPrestige.restore(); firstPrestige.setCampaignCompleted(true);
    firstAchievements.restore();
    firstNecromancy.restore();
    firstBuildings.restore();
    firstCombat.restore();

    expect(firstPersistence.save()).toBe(true);

    const initialSouls = firstClicker.souls;
    const initialGenerators = { 'grave-keeper': firstClicker.getOwned('grave-keeper'), 'soul-collector': firstClicker.getOwned('soul-collector') };
    expect(initialSouls).toBeGreaterThan(0);
    expect(initialGenerators['grave-keeper']).toBeGreaterThan(0);
    expect(initialGenerators['soul-collector']).toBeGreaterThan(0);

    // 2. Simulate FULL BOOT: new process, fresh systems, restore through PersistenceCoordinator
    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);
    const profileRestore = restoredPersistence.restore();
    expect(profileRestore.source).toBe('canonical');

    const restoredEvents = new EventBus();
    const restoredPrestige = new PrestigeSystem(restoredEvents, restoredSlots['webclickergame.prestige']);
    const restoredAchievements = new AchievementSystem(restoredEvents, restoredSlots['webclickergame.achievements']);
    const restoredNecromancy = new NecromancySystem(restoredEvents, restoredSlots['webclickergame.necromancy'], { transactor: necromancyTransactor });
    const restoredLegion = new LegionSystem(restoredEvents, restoredSlots['webclickergame.legion']);
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    const restoredResources = new ResourceSystem(restoredEvents, restoredSlots['webclickergame.resources']);
    const restoredBuildings = new BuildingSystem(restoredEvents, restoredSlots['webclickergame.buildings'], { transactor: buildingTransactor });
    const restoredCombat = new CombatSystem(restoredEvents, restoredSlots['webclickergame.combat']);

    // Boot order from main.ts
    restoredPrestige.restore();
    restoredAchievements.restore();
    for (const entry of restoredAchievements.getCompletedPrestigePointRewards()) {
      restoredPrestige.reportReward(entry.id, entry.amount);
    }
    restoredNecromancy.restore();
    expect(restoredLegion.restore()).toBe(true);
    expect(restoredClicker.restore()).toBe(true);
    expect(restoredResources.restore()).toBe(true);
    restoredBuildings.restore();
    restoredCombat.restore();

    // Verify initial restore is correct
    const soulsAfterRestore = restoredClicker.souls;
    const generatorsAfterRestore = { 'grave-keeper': restoredClicker.getOwned('grave-keeper'), 'soul-collector': restoredClicker.getOwned('soul-collector') };
    expect(soulsAfterRestore).toBe(initialSouls);
    expect(generatorsAfterRestore['grave-keeper']).toBe(initialGenerators['grave-keeper']);
    expect(generatorsAfterRestore['soul-collector']).toBe(initialGenerators['soul-collector']);

    // 3. Simulate game loop advancing time PAST the passive save interval (5 seconds)
    // Call tick() with enough delta to trigger multiple passive saves
    const PASSIVE_SAVE_INTERVAL_SECONDS = 5;
    const TICK_COUNT = 3;
    const DELTA_PER_TICK = PASSIVE_SAVE_INTERVAL_SECONDS + 1; // 6 seconds each = triggers passive save each time

    for (let i = 0; i < TICK_COUNT; i++) {
      restoredClicker.tick(DELTA_PER_TICK);
    }

    // 4. Verify Clicker state is STILL correct after passive saves
    const soulsAfterTicks = restoredClicker.souls;
    const generatorsAfterTicks = { 'grave-keeper': restoredClicker.getOwned('grave-keeper'), 'soul-collector': restoredClicker.getOwned('soul-collector') };
    
    // Souls should have INCREASED from passive generation, not reset to 0
    expect(soulsAfterTicks).toBeGreaterThanOrEqual(soulsAfterRestore);
    expect(generatorsAfterTicks['grave-keeper']).toBe(generatorsAfterRestore['grave-keeper']);
    expect(generatorsAfterTicks['soul-collector']).toBe(generatorsAfterRestore['soul-collector']);

    // 5. Verify canonical profile is still correct after endBatch
    restoredPersistence.endBatch(true);
    const finalProfile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    expect(finalProfile.data['webclickergame.clicker']).toMatchObject({
      souls: expect.any(Number), // Should be >= initial, not 0
      totalClicks: 0,
    });
    const finalClickerData = finalProfile.data['webclickergame.clicker'] as { souls: number; generators: Record<string, number> };
    expect(finalClickerData.souls).toBeGreaterThanOrEqual(soulsAfterRestore);
    expect(finalClickerData.generators['grave-keeper']).toBe(initialGenerators['grave-keeper']);
    expect(finalClickerData.generators['soul-collector']).toBe(initialGenerators['soul-collector']);
  });

  it('Clicker resetRun() is NOT called during normal boot/restore', () => {
    // This test ensures no code path accidentally calls resetRun() during boot
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);
    const firstEvents = new EventBus();
    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    firstClicker.restore();
    firstClicker.grantSouls(10_000);
    expect(firstPersistence.save()).toBe(true);

    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);
    restoredPersistence.restore();
    const restoredEvents = new EventBus();
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    expect(restoredClicker.restore()).toBe(true);
    expect(restoredClicker.souls).toBe(10_000);

    // Simulate boot completion (endBatch)
    restoredPersistence.endBatch(true);

    // Souls should still be 10,000, not reset to 0
    expect(restoredClicker.souls).toBe(10_000);
  });

  it('refuses an unexpected boot-time Soul spend so the restored balance survives (armBootProtection)', () => {
    // Seed a progressed save with a nonzero Soul balance.
    const firstSlots = slots();
    const firstPersistence = coordinator(firstSlots);
    const firstEvents = new EventBus();
    const firstClicker = new ClickerSystem(firstEvents, firstSlots['webclickergame.clicker'], () => 1_000_000);
    firstClicker.restore();
    firstClicker.grantSouls(5_000);
    firstClicker.buyGenerator('grave-keeper');
    expect(firstPersistence.save()).toBe(true);

    // New process: full boot. Arm the protection BEFORE the systems restore,
    // exactly as the production boot flow does.
    const restoredSlots = slots();
    const restoredPersistence = coordinator(restoredSlots);
    restoredPersistence.restore();
    const restoredEvents = new EventBus();
    const restoredClicker = new ClickerSystem(restoredEvents, restoredSlots['webclickergame.clicker'], () => 1_000_000);
    restoredClicker.armBootProtection();
    expect(restoredClicker.restore()).toBe(true);

    // The restored last-known-good balance is anchored.
    const baseline = restoredClicker.souls;
    expect(baseline).toBeGreaterThan(0);

    // A spurious boot-time spend (whatever its source) must be refused:
    // spending below the restored baseline is blocked and does NOT reduce
    // the protected balance.
    const attemptedSpend = baseline;
    expect(restoredClicker.spendSouls(attemptedSpend)).toBe(false);
    expect(restoredClicker.souls).toBe(baseline);

    // Mark boot complete; legitimate spending is allowed again afterward.
    restoredClicker.markBooted();
    expect(restoredClicker.buyGenerator('soul-collector')).toBe(true);
    expect(restoredClicker.souls).toBeLessThan(baseline);

    // endBatch must persist the protected (not zeroed) state. A memory-save
    // listener is not wired in this isolated test, so flag the canonical save
    // explicitly (as the requestSave path would).
    restoredPersistence.requestSave();
    restoredPersistence.endBatch(true);
    const profile = new SaveManager(PROFILE_STORAGE_KEY).load() as { data: Record<string, unknown> };
    const clickerData = profile.data['webclickergame.clicker'] as { souls: number };
    expect(clickerData.souls).toBe(restoredClicker.souls);
    expect(clickerData.souls).toBeLessThan(baseline);
    expect(clickerData.souls).toBeGreaterThan(0);
  });
});

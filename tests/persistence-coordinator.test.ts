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
import { ClickerSystem } from '../src/systems/clicker/ClickerSystem';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import { ResourceSystem } from '../src/systems/resources/ResourceSystem';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
  resumePersistence();
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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  SaveManager,
  isPersistenceSuspended,
  resumePersistence,
  suspendPersistence,
} from '../src/core/SaveManager';
import { AppEvents } from '../src/core/Application';
import { EventBus } from '../src/core/EventBus';
import { PrestigeSystem } from '../src/systems/prestige/PrestigeSystem';
import {
  BACKUP_FORMAT,
  commitImport,
  parseImport,
  wipeGameSaves,
} from '../src/core/SaveBackup';
import { installMemoryStorage } from './support/storage';

beforeEach(() => {
  installMemoryStorage();
});

const rawKey = (key: string): unknown => {
  const stored = localStorage.getItem(key);
  return stored === null ? null : JSON.parse(stored);
};

describe('wipeGameSaves', () => {
  it('removes every webclickergame.* key and keeps foreign ones', () => {
    localStorage.setItem('webclickergame.clicker', '{"souls":1}');
    localStorage.setItem('webclickergame.prestige', '{"count":2}');
    localStorage.setItem('webclickergame.session', '{}');
    localStorage.setItem('other.game', 'keep');

    const removed = wipeGameSaves();

    expect(removed.sort()).toEqual([
      'webclickergame.clicker',
      'webclickergame.prestige',
      'webclickergame.session',
    ]);
    expect(localStorage.getItem('webclickergame.clicker')).toBeNull();
    expect(localStorage.getItem('other.game')).toBe('keep');
  });
});

describe('save import parsing + commit', () => {
  const payloadOf = (data: Record<string, unknown>): string =>
    JSON.stringify({
      app: 'endless-souls',
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      origin: 'http://localhost/',
      data,
    });

  it('rejects malformed or foreign backups without touching storage', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('{"app":"other"}').ok).toBe(false);
    expect(parseImport(payloadOf({})).ok).toBe(false); // no recognizable keys
    expect(localStorage.length).toBe(0);
  });

  it('filters unknown keys and never writes them', () => {
    const parsed = parseImport(
      payloadOf({
        'webclickergame.clicker': { souls: 10 },
        'evil.key': 'nope',
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.entries.map(([key]) => key)).toEqual(['webclickergame.clicker']);

    const summary = commitImport(parsed.entries);
    expect(summary.ok).toBe(true);
    expect(rawKey('webclickergame.clicker')).toEqual({ souls: 10 });
    expect(localStorage.getItem('evil.key')).toBeNull();
  });

  it('null entries remove their key on commit', () => {
    localStorage.setItem('webclickergame.legion', '{"old":true}');
    const parsed = parseImport(payloadOf({ 'webclickergame.legion': null }));
    commitImport(parsed.entries);
    expect(localStorage.getItem('webclickergame.legion')).toBeNull();
  });
});

describe('persistence suspension (reset/import reload guard)', () => {
  it('blocks SaveManager writes while suspended and resumes after', () => {
    const saves = new SaveManager('test.blocked');
    saves.save({ n: 1 });
    expect(rawKey('test.blocked')).toEqual({ n: 1 });

    suspendPersistence();
    expect(isPersistenceSuspended()).toBe(true);
    expect(saves.save({ n: 2 })).toBe(false);
    expect(rawKey('test.blocked')).toEqual({ n: 1 }); // unchanged

    resumePersistence();
    expect(saves.save({ n: 3 })).toBe(true);
    expect(rawKey('test.blocked')).toEqual({ n: 3 });
  });

  it('TOTAL RESET sequence: wiped keys stay gone through a simulated unload cascade', () => {
    const prestige = new PrestigeSystem(new EventBus(), new SaveManager('webclickergame.prestige'));
    prestige.restore();
    prestige.reportReward('age:age-of-ash', 1); // seeds a real blob

    expect(rawKey('webclickergame.prestige')).not.toBeNull();

    // The terminal flow arms the gate BEFORE mutating storage...
    suspendPersistence();
    wipeGameSaves();

    // ...then the browser fires the unload cascade on location.reload().
    // Every system re-saves its stale state; none of it may land.
    new SaveManager('webclickergame.clicker').save({ souls: 999 });
    new EventBus().emit(AppEvents.Flush); // all Flush listeners fire

    expect(localStorage.getItem('webclickergame.prestige')).toBeNull();
    expect(localStorage.getItem('webclickergame.clicker')).toBeNull();
  });

  it('IMPORT sequence: committed blobs survive a simulated unload cascade', () => {
    // Stale session state that the old bug would resurrect over the import.
    new SaveManager('webclickergame.clicker').save({ souls: 111 });

    const parsed = parseImport(
      JSON.stringify({
        app: 'endless-souls',
        format: BACKUP_FORMAT,
        schemaVersion: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        origin: 'http://localhost/',
        data: {
          'webclickergame.clicker': { v: 1, souls: 4321 },
        },
      }),
    );
    expect(commitImport(parsed.entries).ok).toBe(true);

    suspendPersistence(); // armed right before location.reload()
    new SaveManager('webclickergame.clicker').save({ souls: 111 });
    new EventBus().emit(AppEvents.Flush);

    expect(rawKey('webclickergame.clicker')).toEqual({ v: 1, souls: 4321 });
  });
});

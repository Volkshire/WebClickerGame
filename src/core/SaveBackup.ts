/**
 * Manual save backups: one JSON file holding every game storage key.
 *
 * localStorage is scoped per-origin AND evictable, so published players have
 * no way to move progress between devices/browsers/hosts or recover from a
 * wiped profile unless they can export/import a file themselves.
 */

import { SAVE_SCHEMA_VERSION } from './SaveManager';

export const BACKUP_FORMAT = 1;

/** Every gameplay storage key owned by the save system (heartbeat excluded). */
export const GAME_SAVE_KEYS = [
  'webclickergame.clicker',
  'webclickergame.legion',
  'webclickergame.resources',
  'webclickergame.prestige',
  'webclickergame.achievements',
  'webclickergame.necromancy',
  'webclickergame.combat',
  'webclickergame.buildings',
  // UI preferences travel with the save so QOL toggles survive restores.
  'webclickergame.ui',
] as const;

export interface SaveBackupPayload {
  app: 'endless-souls';
  format: number;
  schemaVersion: number;
  exportedAt: string;
  origin: string;
  /** Storage key -> parsed JSON value (null entries are preserved as null). */
  data: Record<string, unknown>;
}

function isGameKey(key: string): boolean {
  return (GAME_SAVE_KEYS as readonly string[]).includes(key);
}

/** Reads localStorage and parses every known key. Corrupt entries become null. */
export function collectSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of GAME_SAVE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      snapshot[key] = raw === null ? null : JSON.parse(raw);
    } catch {
      snapshot[key] = null;
    }
  }
  return snapshot;
}

function buildBackupPayload(): SaveBackupPayload {
  return {
    app: 'endless-souls',
    format: BACKUP_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    origin: typeof location !== 'undefined' ? location.origin : 'unknown',
    data: collectSnapshot(),
  };
}

/** Serializes + triggers a browser download of the full backup file. */
export function downloadSaveBackup(): string {
  const payload = buildBackupPayload();
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const filename = `endless-souls-save-${stamp}.json`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export interface ParsedImport {
  ok: boolean;
  problem: string | null;
  /** Validated key/value pairs ready to be written by commitImport(). */
  entries: [string, unknown][];
}

export interface ImportSummary {
  ok: boolean;
  restoredKeys: string[];
  skippedKeys: string[];
}

/**
 * Validates an imported backup file WITHOUT touching storage, so the caller
 * can ask for confirmation first. Light validation here: strict per-system
 * parsing happens on restore after reload, and a bad blob only resets its
 * own system (never the whole save).
 */
export function parseImport(text: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: `Not valid JSON: ${String(error)}`, entries: [] };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problem: 'Not a save file (expected an object).', entries: [] };
  }
  const record = parsed as Record<string, unknown>;
  if (record['data'] === undefined || record['data'] === null || typeof record['data'] !== 'object') {
    return { ok: false, problem: 'Missing "data" section.', entries: [] };
  }
  if (
    record['app'] !== 'endless-souls' ||
    typeof record['format'] !== 'number' ||
    record['format'] !== BACKUP_FORMAT
  ) {
    return { ok: false, problem: 'Not an Endless Souls save backup.', entries: [] };
  }

  // Schema gate: per-system restore rejects blobs whose `v` differs from
  // SAVE_SCHEMA_VERSION, so importing an incompatible backup would pass this
  // validation, look successful, then silently reset EVERY system on reload
  // (and the next autosave overwrites the originals). Refuse up front with a
  // clear message instead of laundering data loss through a confirm dialog.
  const backupSchema = record['schemaVersion'];
  if (typeof backupSchema !== 'number') {
    return { ok: false, problem: 'Save file is missing a schema version.', entries: [] };
  }
  if (backupSchema > SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        `Backup is from a newer game version (schema ${backupSchema} > ${SAVE_SCHEMA_VERSION}). Update the game first.`,
      entries: [],
    };
  }
  if (backupSchema < SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        `Backup is from an older game version (schema ${backupSchema} < ${SAVE_SCHEMA_VERSION}) and can no longer be imported.`,
      entries: [],
    };
  }

  const data = record['data'] as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!isGameKey(key)) continue; // foreign/unknown entry — never written blindly
    entries.push([key, value]);
  }
  if (entries.length === 0) {
    return { ok: false, problem: 'No recognizable game saves in the file.', entries: [] };
  }
  return { ok: true, problem: null, entries };
}

/** Writes previously validated entries into localStorage. */
export function commitImport(entries: [string, unknown][]): ImportSummary {
  const restoredKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const [key, value] of entries) {
    try {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
      restoredKeys.push(key);
    } catch {
      skippedKeys.push(key);
    }
  }

  return { ok: restoredKeys.length > 0, restoredKeys, skippedKeys };
}

/** Storage prefix owned by this game — every save, UI pref and heartbeat. */
const SAVE_KEY_PREFIX = 'webclickergame.';

/**
 * Debug tooling: removes EVERY key under the game's storage prefix — all
 * run saves, the Prestige counter, UI preferences and the session
 * heartbeat. Deliberately a prefix sweep instead of localStorage.clear()
 * so foreign keys on shared origins survive. Returns the removed keys.
 */
export function wipeGameSaves(): string[] {
  const removed: string[] = [];
  try {
    // Copy first: some browsers dislike mutating the index mid-iteration.
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith(SAVE_KEY_PREFIX),
    );
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
        removed.push(key);
      } catch {
        // Unremovable key: leave it, report nothing for it.
      }
    }
  } catch (error) {
    console.error('SaveBackup: wiping game saves failed.', error);
  }
  return removed;
}

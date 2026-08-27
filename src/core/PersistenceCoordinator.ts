import { SaveManager } from './SaveManager';

export const PROFILE_STORAGE_KEY = 'webclickergame.profile';
export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_BACKUP_FORMAT = 2;

export const LEGACY_PROFILE_KEYS = [
  'webclickergame.clicker',
  'webclickergame.legion',
  'webclickergame.resources',
  'webclickergame.prestige',
  'webclickergame.achievements',
  'webclickergame.necromancy',
  'webclickergame.combat',
  'webclickergame.buildings',
  'webclickergame.ui',
] as const;

export type ProfileSection = (typeof LEGACY_PROFILE_KEYS)[number];
export type ProfileSlots = Record<ProfileSection, SaveManager>;

export interface CanonicalProfile {
  app: 'endless-souls';
  schemaVersion: number;
  data: Record<ProfileSection, unknown>;
}

export interface RestoreProfileResult {
  source: 'canonical' | 'legacy' | 'empty' | 'invalid';
  problem: string | null;
}

export interface ProfileImport {
  ok: boolean;
  problem: string | null;
  profile: CanonicalProfile | null;
}

/**
 * Owns the application's one durable save. Systems retain their existing
 * SaveManager contracts, but application instances use memory-backed managers
 * whose values are collected here into one coherent profile snapshot.
 */
export class PersistenceCoordinator {
  private batchDepth = 0;
  private dirty = false;

  constructor(
    private readonly profileSave: SaveManager,
    private readonly slots: ProfileSlots,
  ) {}

  beginBatch(): void {
    this.batchDepth += 1;
  }

  endBatch(save = true): boolean {
    if (this.batchDepth === 0) return false;
    this.batchDepth -= 1;
    if (this.batchDepth > 0) return true;
    if (!save) {
      this.dirty = false;
      return true;
    }
    if (!this.dirty) return true;
    this.dirty = false;
    return this.save();
  }

  requestSave(): boolean {
    this.dirty = true;
    if (this.batchDepth > 0) return true;
    this.dirty = false;
    return this.save();
  }

  save(): boolean {
    return this.profileSave.save(this.collect());
  }

  collect(): CanonicalProfile {
    const data = {} as Record<ProfileSection, unknown>;
    for (const key of LEGACY_PROFILE_KEYS) data[key] = this.slots[key].load();
    return { app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION, data };
  }

  restore(): RestoreProfileResult {
    const canonical = parseCanonicalProfile(this.profileSave.load());
    if (canonical.ok && canonical.profile !== null) {
      this.hydrate(canonical.profile);
      return { source: 'canonical', problem: null };
    }

    const legacy = collectLegacyProfile();
    if (legacy !== null) {
      this.hydrate(legacy);
      return { source: 'legacy', problem: null };
    }

    return {
      source: canonical.problem === null ? 'empty' : 'invalid',
      problem: canonical.problem,
    };
  }

  migrateLegacy(): boolean {
    const saved = this.save();
    if (saved) this.clearLegacySections();
    return saved;
  }

  parseImport(text: string): ProfileImport {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, problem: `Not valid JSON: ${String(error)}`, profile: null };
    }

    const wrappedCanonical = profileFromCanonicalBackup(parsed);
    if (wrappedCanonical !== null) return wrappedCanonical;

    const canonical = parseCanonicalProfile(parsed);
    if (canonical.ok) return canonical;

    // Production backups from the deployed build contain the legacy `data`
    // map. Accept them only as migration input; imports are persisted as one
    // canonical profile.
    const legacy = profileFromLegacyBackup(parsed);
    return legacy ?? canonical;
  }

  commitImport(profile: CanonicalProfile): boolean {
    const saved = this.profileSave.save(profile);
    if (saved) this.clearLegacySections();
    return saved;
  }

  downloadBackup(): string {
    const exportedAt = new Date().toISOString();
    const payload = {
      app: 'endless-souls',
      format: PROFILE_BACKUP_FORMAT,
      exportedAt,
      origin: typeof location !== 'undefined' ? location.origin : 'unknown',
      profile: this.collect(),
    };
    const stamp = exportedAt.slice(0, 19).replace(/[:T]/g, '-');
    const filename = `endless-souls-save-${stamp}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  reset(): string[] {
    const removed: string[] = [];
    for (const key of [PROFILE_STORAGE_KEY, ...LEGACY_PROFILE_KEYS, 'webclickergame.session']) {
      try {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          removed.push(key);
        }
      } catch {
        // Preserve the old best-effort reset behavior.
      }
    }
    return removed;
  }

  private hydrate(profile: CanonicalProfile): void {
    for (const key of LEGACY_PROFILE_KEYS) this.slots[key].replace(profile.data[key]);
  }

  private clearLegacySections(): void {
    for (const key of LEGACY_PROFILE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        // A retained legacy key is harmless because canonical data wins.
      }
    }
  }
}

function parseCanonicalProfile(raw: unknown): ProfileImport {
  if (raw === null || raw === undefined) return { ok: false, problem: null, profile: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problem: 'Canonical profile is not an object.', profile: null };
  }
  const record = raw as Record<string, unknown>;
  if (record['app'] !== 'endless-souls') {
    return { ok: false, problem: 'Not an Endless Souls profile.', profile: null };
  }
  const version = record['schemaVersion'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    return { ok: false, problem: 'Profile is missing a schema version.', profile: null };
  }
  const migrated = migrateProfile(record, version);
  if (migrated === null) {
    return { ok: false, problem: `Unsupported profile schema ${version}.`, profile: null };
  }
  return { ok: true, problem: null, profile: migrated };
}

function migrateProfile(record: Record<string, unknown>, version: number): CanonicalProfile | null {
  // Keep migration dispatch explicit even while v1 is the only canonical
  // profile. Future versions add a case here rather than weakening parsing.
  if (version !== PROFILE_SCHEMA_VERSION) return null;
  const rawData = record['data'];
  if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
  const data = {} as Record<ProfileSection, unknown>;
  for (const key of LEGACY_PROFILE_KEYS) data[key] = (rawData as Record<string, unknown>)[key] ?? null;
  return { app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION, data };
}

function collectLegacyProfile(): CanonicalProfile | null {
  const data = {} as Record<ProfileSection, unknown>;
  let found = false;
  for (const key of LEGACY_PROFILE_KEYS) {
    const value = new SaveManager(key).load();
    data[key] = value;
    found ||= value !== null;
  }
  return found ? { app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION, data } : null;
}

function profileFromLegacyBackup(raw: unknown): ProfileImport | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record['app'] !== 'endless-souls' || record['format'] !== 1) return null;
  const data = record['data'];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, problem: 'Legacy backup is missing a data section.', profile: null };
  }
  const profileData = {} as Record<ProfileSection, unknown>;
  let found = false;
  for (const key of LEGACY_PROFILE_KEYS) {
    const value = (data as Record<string, unknown>)[key];
    profileData[key] = value ?? null;
    found ||= value !== undefined;
  }
  if (!found) return { ok: false, problem: 'No recognizable game saves in the backup.', profile: null };
  return {
    ok: true,
    problem: null,
    profile: { app: 'endless-souls', schemaVersion: PROFILE_SCHEMA_VERSION, data: profileData },
  };
}

function profileFromCanonicalBackup(raw: unknown): ProfileImport | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record['app'] !== 'endless-souls' || record['format'] !== PROFILE_BACKUP_FORMAT) return null;
  if (record['profile'] === undefined) {
    return { ok: false, problem: 'Canonical backup is missing its profile.', profile: null };
  }
  return parseCanonicalProfile(record['profile']);
}

/** Current schema version stamped into every game save blob. */
export const SAVE_SCHEMA_VERSION = 1;

/**
 * Global write gate. Armed by terminal flows (TOTAL RESET, save import)
 * right before they mutate storage behind the game's back and reload the
 * page: the unload cascade (pagehide/visibilitychange -> AppEvents.Flush,
 * beforeunload -> AppEvents.Stop) would otherwise re-save every system's
 * stale in-memory state OVER the wiped/imported blobs, silently undoing
 * the operation. Intentionally NOT resumed anywhere — the navigation is
 * the resume.
 */
let persistenceSuspended = false;

export function suspendPersistence(): void {
  persistenceSuspended = true;
}

export function resumePersistence(): void {
  persistenceSuspended = false;
}

export function isPersistenceSuspended(): boolean {
  return persistenceSuspended;
}

/**
 * Validates the `v` marker of a parsed save record. Absent markers are
 * accepted (pre-versioning saves were all v1); FUTURE versions are rejected
 * so an older build fails safe instead of misreading newer formats.
 */
export function isSupportedSchemaVersion(record: Record<string, unknown>): boolean {
  const version = record['v'];
  if (version === undefined || version === null) return true; // legacy == v1
  return version === SAVE_SCHEMA_VERSION;
}

export class SaveManager {
  private readonly storageKey: string;
  private readonly onWriteError: ((error: unknown) => void) | null;

  constructor(storageKey: string, onWriteError?: (error: unknown) => void) {
    this.storageKey = storageKey;
    this.onWriteError = onWriteError ?? null;
  }

  save(data: unknown): boolean {
    if (persistenceSuspended) return false;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      return true;
    } catch (error) {
      // Persisted-progress loss is always critical: never swallow silently.
      console.error(
        `SaveManager: saving "${this.storageKey}" FAILED — progress not persisted.`,
        error,
      );
      this.onWriteError?.(error);
      return false;
    }
  }

  load(): unknown {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw === null) return null;
      return JSON.parse(raw) as unknown;
    } catch (error) {
      console.error(`SaveManager: loading "${this.storageKey}" failed; treating as empty.`, error);
      return null;
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error(`SaveManager: clearing "${this.storageKey}" failed.`, error);
    }
  }
}

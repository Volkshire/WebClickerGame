/** Current schema version stamped into every game save blob. */
export const SAVE_SCHEMA_VERSION = 1;

export interface SaveManagerOptions {
  /**
   * Profile-managed systems keep their familiar per-system save contract in
   * memory. The PersistenceCoordinator is then the sole writer of the
   * canonical localStorage profile.
   */
  persistent?: boolean;
}

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
  private readonly persistent: boolean;
  private memoryData: unknown = null;
  private onMemorySave: (() => void) | null = null;

  constructor(
    storageKey: string,
    onWriteError?: (error: unknown) => void,
    options: SaveManagerOptions = {},
  ) {
    this.storageKey = storageKey;
    this.onWriteError = onWriteError ?? null;
    this.persistent = options.persistent ?? true;
  }

  save(data: unknown): boolean {
    if (persistenceSuspended) {
      console.log('[SAVE] SaveManager.save - suspended, skipping', { key: this.storageKey });
      return false;
    }
    if (!this.persistent) {
      this.memoryData = cloneSaveData(data);
      this.onMemorySave?.();
      return true;
    }
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      console.log('[SAVE] SaveManager.save - persistent write', { key: this.storageKey });
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
    if (!this.persistent) return cloneSaveData(this.memoryData);
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
    if (!this.persistent) {
      this.memoryData = null;
      return;
    }
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error(`SaveManager: clearing "${this.storageKey}" failed.`, error);
    }
  }

  /** Hydrates a profile-managed system without writing legacy localStorage. */
  replace(data: unknown): void {
    this.memoryData = cloneSaveData(data);
  }

  /** Registers the canonical profile writer for a memory-backed system. */
  setMemorySaveListener(listener: (() => void) | null): void {
    this.onMemorySave = listener;
  }
}

function cloneSaveData(data: unknown): unknown {
  if (data === null || data === undefined) return null;
  // The normal localStorage path serializes then parses, so match that
  // isolation boundary for profile-managed in-memory system saves.
  try {
    return JSON.parse(JSON.stringify(data)) as unknown;
  } catch {
    return null;
  }
}

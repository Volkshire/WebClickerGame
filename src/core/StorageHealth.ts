/**
 * Boot-time health check for the browser storage the save system depends on.
 * Private windows, "block site data" settings and quota errors make
 * localStorage writes fail SILENTLY — players would lose everything without
 * ever seeing a reason. The probe surfaces that before the first click.
 */
export interface StorageHealthReport {
  available: boolean;
  /** Human-readable failure cause when `available` is false. */
  reason: string | null;
}

const PROBE_KEY = 'webclickergame.storage-probe';

/** Write/read/remove test. Cheap, synchronous, safe to call every boot. */
export function probeStorage(): StorageHealthReport {
  try {
    if (typeof localStorage === 'undefined') {
      return { available: false, reason: 'localStorage is not supported by this browser.' };
    }
    localStorage.setItem(PROBE_KEY, 'ok');
    const readBack = localStorage.getItem(PROBE_KEY);
    localStorage.removeItem(PROBE_KEY);
    if (readBack !== 'ok') {
      return { available: false, reason: 'Storage write could not be read back.' };
    }
    return { available: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: message };
  }
}

/**
 * Asks the browser to keep this origin's storage from being evicted under
 * pressure. Fire-and-forget: unsupported browsers resolve to null, denial
 * just means best-effort persistence as usual.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const manager = navigator.storage;
    if (manager?.persist === undefined) return null;
    return await manager.persist();
  } catch {
    return null;
  }
}

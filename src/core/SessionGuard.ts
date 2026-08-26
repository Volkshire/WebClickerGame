import type { SaveManager } from './SaveManager';

interface HeartbeatBlob {
  id: string;
  stamp: number;
}

/** How often this instance refreshes its heartbeat. */
const BEAT_INTERVAL_MS = 3000;
/** Heartbeats older than this belong to dead sessions and are ignored. */
const FOREIGN_FRESH_WINDOW_MS = 15000;

/**
 * Best-effort detection of multiple live game instances sharing one origin's
 * localStorage (a second tab/window, or a duplicated module mount). A foreign
 * *fresh* heartbeat means another writer is active and can resurrect stale
 * saves over freshly-reset ones. Detection only — gameplay is never blocked.
 */
export class SessionGuard {
  private readonly sessionId: string;
  private lastBeatAtMs = Number.NEGATIVE_INFINITY;
  private readonly warnedForeignIds = new Set<string>();

  constructor(
    private readonly saves: SaveManager,
    private readonly now: () => number = Date.now,
    /** Optional UI hook: fires once per detected foreign live session. */
    private readonly onForeignDetected?: (foreignId: string) => void,
  ) {
    this.sessionId = createSessionId();
  }

  /** Boot-time check; returns true when a live foreign session was detected. */
  checkOnBoot(): boolean {
    const parsed = parseHeartbeat(this.saves.load());
    if (
      parsed !== null &&
      parsed.id !== this.sessionId &&
      this.now() - parsed.stamp < FOREIGN_FRESH_WINDOW_MS
    ) {
      this.warn(parsed.id);
      return true;
    }
    return false;
  }

  /** Cheap periodic call from the update loop; self-throttled. */
  beat(): void {
    const nowMs = this.now();
    if (nowMs - this.lastBeatAtMs < BEAT_INTERVAL_MS) return;
    this.lastBeatAtMs = nowMs;

    const parsed = parseHeartbeat(this.saves.load());
    if (
      parsed !== null &&
      parsed.id !== this.sessionId &&
      nowMs - parsed.stamp < FOREIGN_FRESH_WINDOW_MS
    ) {
      this.warn(parsed.id);
    }

    this.saves.save({ id: this.sessionId, stamp: nowMs });
  }

  private warn(foreignId: string): void {
    if (this.warnedForeignIds.has(foreignId)) return;
    this.warnedForeignIds.add(foreignId);
    console.error(
      'SessionGuard: another live game instance is writing to the same storage. ' +
        'Saves may overwrite each other (e.g. after Prestige). Close extra tabs/windows.',
    );
    this.onForeignDetected?.(foreignId);
  }
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseHeartbeat(raw: unknown): HeartbeatBlob | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  const stamp = record['stamp'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0) return null;
  return { id, stamp };
}

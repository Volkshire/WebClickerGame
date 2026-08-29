import type { SaveManager } from './SaveManager';

interface HeartbeatBlob {
  id: string;
  stamp: number;
}

/** How often this instance refreshes its heartbeat. */
const BEAT_INTERVAL_MS = 3000;
/** Heartbeats older than this belong to dead sessions and are ignored. */
const FOREIGN_FRESH_WINDOW_MS = 15000;
/** sessionStorage key for our session ID across reloads. */
const SESSION_STORAGE_KEY = 'webclickergame.session.id';

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
    this.sessionId = this.resolveSessionId();
  }

  private resolveSessionId(): string {
    let previousId: string | null = null;
    try {
      previousId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable (private mode, etc.) — treat as new session
    }

    if (previousId !== null) {
      const parsed = parseHeartbeat(this.saves.load());
      if (
        parsed !== null &&
        parsed.id === previousId &&
        this.now() - parsed.stamp < FOREIGN_FRESH_WINDOW_MS
      ) {
        console.log('[SAVE] SessionGuard - reusing session ID from sessionStorage (reload detected)', {
          sessionId: previousId,
        });
        return previousId;
      }
    }

    const newId = createSessionId();
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, newId);
    } catch {
      // sessionStorage unavailable
    }
    console.log('[SAVE] SessionGuard - new session ID generated', { sessionId: newId });
    return newId;
  }

  /** Boot-time check; returns true when a live foreign session was detected. */
  checkOnBoot(): boolean {
    const parsed = parseHeartbeat(this.saves.load());
    console.log('[SAVE] SessionGuard.checkOnBoot', {
      sessionId: this.sessionId,
      foundHeartbeat: parsed !== null,
      heartbeatId: parsed?.id,
      isOwnSession: parsed?.id === this.sessionId,
      ageMs: parsed ? this.now() - parsed.stamp : null,
      isFresh: parsed ? this.now() - parsed.stamp < FOREIGN_FRESH_WINDOW_MS : null,
    });
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
    console.log('[SAVE] SessionGuard.beat', {
      sessionId: this.sessionId,
      foundHeartbeat: parsed !== null,
      heartbeatId: parsed?.id,
      isOwnSession: parsed?.id === this.sessionId,
      ageMs: parsed ? nowMs - parsed.stamp : null,
      isFresh: parsed ? nowMs - parsed.stamp < FOREIGN_FRESH_WINDOW_MS : null,
    });

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

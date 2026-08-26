export type UpdateCallback = (deltaSeconds: number) => void;

const MAX_DELTA_SECONDS = 0.1;

/** Match the combat tick interval so hidden-tab updates drain cleanly. */
const BG_TICK_MS = 700;

export class GameLoop {
  private readonly update: UpdateCallback;
  private handle: number | null = null;
  private bgInterval: ReturnType<typeof setInterval> | null = null;
  private lastTime: number | null = null;
  private running = false;

  constructor(update: UpdateCallback) {
    this.update = update;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Registered here rather than the constructor so a stop() -> start()
    // cycle keeps hidden-tab switching alive (removal happens in stop()).
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // A page can boot while hidden (background-tab open, mobile restore):
    // rAF never fires there and no transition event arrives until focus,
    // so pick the right mode up front instead of stalling until click.
    if (document.visibilityState === 'hidden') {
      this.startBg();
    } else {
      this.startRaf();
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.cancelRaf();
    this.cancelBg();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ---- rAF mode (visible tab) ----

  private startRaf(): void {
    // Guard against duplicate transitions forking a second rAF chain that
    // would double-tick every system and could never be cancelled.
    if (this.handle !== null) return;
    this.lastTime = null;
    this.handle = requestAnimationFrame(this.tick);
  }

  private cancelRaf(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private tick = (timeMs: number): void => {
    if (!this.running) return;

    const delta =
      this.lastTime === null
        ? 0
        : Math.min((timeMs - this.lastTime) / 1000, MAX_DELTA_SECONDS);

    this.lastTime = timeMs;
    try {
      this.update(delta);
    } catch (error) {
      console.error('GameLoop: update tick threw.', error);
    } finally {
      if (this.running) this.handle = requestAnimationFrame(this.tick);
    }
  };

  // ---- setInterval mode (hidden tab) ----

  private startBg(): void {
    // Same duplicate-transition guard: a leaked interval would keep granting
    // sim time alongside the rAF loop (~2x speed).
    if (this.bgInterval !== null) return;
    this.bgInterval = setInterval(() => {
      if (!this.running) return;
      try {
        this.update(BG_TICK_MS / 1000);
      } catch (error) {
        console.error('GameLoop: bg tick threw.', error);
      }
    }, BG_TICK_MS);
  }

  private cancelBg(): void {
    if (this.bgInterval !== null) clearInterval(this.bgInterval);
    this.bgInterval = null;
  }

  // ---- Visibility toggle ----

  private onVisibilityChange = (): void => {
    if (!this.running) return;

    if (document.visibilityState === 'hidden') {
      this.cancelRaf();
      this.startBg();
    } else {
      this.cancelBg();
      this.startRaf();
    }
  };
}

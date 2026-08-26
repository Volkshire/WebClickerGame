import { EventBus } from './EventBus';
import { GameLoop } from './GameLoop';

export const AppEvents = {
  Start: 'app:start',
  Stop: 'app:stop',
  Update: 'app:update',
  /**
   * Fired when the page is being hidden (tab switch, minimize) or unloaded
   * via pagehide. Systems must persist immediately; unlike Stop the app
   * keeps running afterwards.
   */
  Flush: 'app:flush',
} as const;

export type UpdatePayload = { deltaSeconds: number };

export class Application {
  readonly events = new EventBus();

  private readonly loop: GameLoop;
  private started = false;

  constructor() {
    this.loop = new GameLoop((deltaSeconds) => {
      this.events.emit<UpdatePayload>(AppEvents.Update, { deltaSeconds });
    });
  }

  get isRunning(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.events.emit(AppEvents.Start);
    this.loop.start();
  }

  stop(): void {
    if (!this.started) return;
    this.loop.stop();
    this.started = false;
    this.events.emit(AppEvents.Stop);
  }
}

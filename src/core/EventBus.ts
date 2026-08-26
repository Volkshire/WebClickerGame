export type EventHandler<TPayload> = (payload: TPayload) => void;

type HandlerMap = Map<string, Set<EventHandler<unknown>>>;

export class EventBus {
  private readonly handlers: HandlerMap = new Map();

  public on<T>(eventType: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(eventType);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler as EventHandler<unknown>);

    return () => this.off(eventType, handler);
  }

  public once<T>(eventType: string, handler: EventHandler<T>): void {
    const unsubscribe = this.on<T>(eventType, (payload) => {
      unsubscribe();
      handler(payload);
    });
  }

  public off<T>(eventType: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(eventType);
    if (set === undefined) return;
    set.delete(handler as EventHandler<unknown>);
    if (set.size === 0) this.handlers.delete(eventType);
  }

  public emit<T>(eventType: string, payload?: T): void {
    const set = this.handlers.get(eventType);
    if (set === undefined) return;
    for (const handler of [...set]) {
      try {
        handler(payload as T);
      } catch (error) {
        // One broken listener must never block the others downstream (a
        // throwing view handler previously aborted the boot-restore cascade
        // and silently wiped progress). The loop keeps delivering.
        console.error(`EventBus: handler for "${eventType}" threw.`, error);
      }
    }
  }
}

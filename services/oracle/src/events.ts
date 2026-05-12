import type { ArenaEvent } from "@mirofish/shared";

/**
 * In-process pub/sub for SSE subscribers. Single-process only — fine for the
 * MVP. Replace with Redis pub/sub when scaling out.
 */
class EventBus {
  private subscribers = new Set<(e: ArenaEvent) => void>();
  private recent: ArenaEvent[] = [];
  private readonly recentCap = 500;

  publish(e: ArenaEvent): void {
    this.recent.push(e);
    if (this.recent.length > this.recentCap) {
      this.recent.splice(0, this.recent.length - this.recentCap);
    }
    for (const fn of this.subscribers) {
      try {
        fn(e);
      } catch {
        // Subscriber bugs shouldn't kill the bus.
      }
    }
  }

  subscribe(fn: (e: ArenaEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  snapshot(): ArenaEvent[] {
    return [...this.recent];
  }
}

export const bus = new EventBus();

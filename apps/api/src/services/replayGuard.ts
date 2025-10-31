const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

const seenEvents = new Map<string, number>();

function purgeExpired(now: number): void {
  for (const [eventId, seenAt] of seenEvents.entries()) {
    if (seenAt <= now - REPLAY_TTL_MS) {
      seenEvents.delete(eventId);
    }
  }
}

export function hasEvent(eventId: string, now = Date.now()): boolean {
  purgeExpired(now);
  return seenEvents.has(eventId);
}

export function rememberEvent(eventId: string, now = Date.now()): void {
  purgeExpired(now);
  seenEvents.set(eventId, now);
}

export function resetReplayGuard(): void {
  seenEvents.clear();
}

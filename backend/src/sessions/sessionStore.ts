import type { GameSearchIntent } from "../types/GameSearchIntent.js";

export interface SessionState {
  currentIntent: GameSearchIntent | null;
  // Exclusión global durante la sesión (juegos ya mostrados, cap FIFO)
  shownGameIds: number[];
  // Mostrados para la intención ACTUAL: define el cap de 8 por pregunta
  shownForCurrentIntent: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface SessionStore {
  // Devuelve la sesión si existe y no ha expirado (renueva lastUsedAt).
  get(userId: number): SessionState | undefined;
  // get o crear; siempre renueva lastUsedAt.
  ensure(userId: number): SessionState;
  save(userId: number, state: SessionState): void;
  evict(userId: number): void;
}

export interface SessionStoreOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<number, SessionState>();
  private now: () => number;

  constructor(private options: SessionStoreOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get(userId: number): SessionState | undefined {
    this.sweep();
    const session = this.sessions.get(userId);
    if (!session) return undefined;

    if (this.now() - session.lastUsedAt >= this.options.ttlMs) {
      this.sessions.delete(userId);
      return undefined;
    }

    session.lastUsedAt = this.now();
    return session;
  }

  ensure(userId: number): SessionState {
    const existing = this.get(userId);
    if (existing) return existing;

    const now = this.now();
    const session: SessionState = {
      currentIntent: null,
      shownGameIds: [],
      shownForCurrentIntent: 0,
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(userId, session);
    this.sweep();
    return session;
  }

  save(userId: number, state: SessionState): void {
    state.lastUsedAt = this.now();
    this.sessions.set(userId, state);
    this.sweep();
  }

  evict(userId: number): void {
    this.sessions.delete(userId);
  }

  // Limpieza perezosa: expira TTLs vencidos y, si seguimos por encima del
  // cap, expulsa las sesiones con lastUsedAt más antiguo.
  private sweep(): void {
    const now = this.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastUsedAt >= this.options.ttlMs) {
        this.sessions.delete(userId);
      }
    }

    if (this.sessions.size <= this.options.maxEntries) return;

    const oldest = [...this.sessions.entries()].sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
    );
    const toEvict = this.sessions.size - this.options.maxEntries;
    for (let i = 0; i < toEvict; i++) {
      const userId = oldest[i]?.[0];
      if (userId !== undefined) this.sessions.delete(userId);
    }
  }
}

// FIFO: añade los ids nuevos y recorta por el principio al superar el cap.
export function appendShownIds(
  ids: number[],
  newIds: number[],
  cap: number,
): number[] {
  const merged = [...ids, ...newIds];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

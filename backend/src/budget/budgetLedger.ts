export type BudgetService = "igdb" | "brave" | "llm" | "embedding";

export interface BudgetLedger {
  remaining(service: BudgetService): number;
  // Reserva atómica: true si hay saldo suficiente para el coste pedido.
  tryReserve(service: BudgetService, cost: number): boolean;
  // La llamada se hizo: la reserva pasa a consumo definitivo.
  commit(service: BudgetService, cost: number): void;
  // Reserva no consumida (fallo antes de salir): se devuelve al saldo.
  release(service: BudgetService, cost: number): void;
}

/*
 * "embedding" es opcional para no forzar a todos los constructores a declarar
 * el cubo nuevo: sin límite declarado, remaining() = 0 y las llamadas de
 * embedding caen al fallback literal de forma segura.
 */
export interface BudgetLimits {
  igdb: number;
  brave: number;
  llm: number;
  embedding?: number;
}

interface DailyCounters {
  igdb: number;
  brave: number;
  llm: number;
  embedding: number;
}

// Contadores por día en memoria. Un reinicio subestima el gasto real, así que
// los límites se configuran con margen bajo el tope real de cada API.
export class InMemoryBudgetLedger implements BudgetLedger {
  private usedByDay = new Map<string, DailyCounters>();
  private reserved: DailyCounters = { igdb: 0, brave: 0, llm: 0, embedding: 0 };
  private now: () => Date;

  constructor(
    private limits: BudgetLimits,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  private dayKey(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private countersFor(dayKey: string): DailyCounters {
    let counters = this.usedByDay.get(dayKey);
    if (!counters) {
      counters = { igdb: 0, brave: 0, llm: 0, embedding: 0 };
      this.usedByDay.set(dayKey, counters);
      this.pruneOldDays(dayKey);
    }
    return counters;
  }

  private pruneOldDays(currentDay: string): void {
    for (const day of this.usedByDay.keys()) {
      if (day !== currentDay) this.usedByDay.delete(day);
    }
  }

  remaining(service: BudgetService): number {
    const limit = this.limits[service] ?? 0;
    const used = this.countersFor(this.dayKey())[service];
    return Math.max(0, limit - used - this.reserved[service]);
  }

  tryReserve(service: BudgetService, cost: number): boolean {
    if (this.remaining(service) < cost) return false;
    this.reserved[service] += cost;
    return true;
  }

  commit(service: BudgetService, cost: number): void {
    const counters = this.countersFor(this.dayKey());
    counters[service] += cost;
    this.reserved[service] = Math.max(0, this.reserved[service] - cost);
  }

  release(service: BudgetService, cost: number): void {
    this.reserved[service] = Math.max(0, this.reserved[service] - cost);
  }
}

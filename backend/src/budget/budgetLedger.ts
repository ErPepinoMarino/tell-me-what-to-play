export type BudgetService = "igdb" | "brave" | "llm";

export interface BudgetLedger {
  remaining(service: BudgetService): number;
  // Reserva atómica: true si hay saldo suficiente para el coste pedido.
  tryReserve(service: BudgetService, cost: number): boolean;
  // La llamada se hizo: la reserva pasa a consumo definitivo.
  commit(service: BudgetService, cost: number): void;
  // Reserva no consumida (fallo antes de salir): se devuelve al saldo.
  release(service: BudgetService, cost: number): void;
}

export type BudgetLimits = Record<BudgetService, number>;

interface DailyCounters {
  igdb: number;
  brave: number;
  llm: number;
}

// Contadores por día en memoria. Un reinicio subestima el gasto real, así que
// los límites se configuran con margen bajo el tope real de cada API.
export class InMemoryBudgetLedger implements BudgetLedger {
  private usedByDay = new Map<string, DailyCounters>();
  private reserved: DailyCounters = { igdb: 0, brave: 0, llm: 0 };
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
      counters = { igdb: 0, brave: 0, llm: 0 };
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
    const used = this.countersFor(this.dayKey())[service];
    return Math.max(0, this.limits[service] - used - this.reserved[service]);
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

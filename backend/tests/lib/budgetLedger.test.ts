import { describe, expect, it } from "vitest";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";

function makeLedger(limits = { igdb: 10, brave: 20, llm: 30 }) {
  let now = new Date("2026-09-01T10:00:00Z");
  const ledger = new InMemoryBudgetLedger(limits, () => now);
  return {
    ledger,
    advanceTo: (date: Date) => {
      now = date;
    },
  };
}

describe("InMemoryBudgetLedger", () => {
  it("parte del límite completo", () => {
    const { ledger } = makeLedger();

    expect(ledger.remaining("igdb")).toBe(10);
    expect(ledger.remaining("brave")).toBe(20);
    expect(ledger.remaining("llm")).toBe(30);
  });

  it("tryReserve bloquea el saldo y commit lo consume", () => {
    const { ledger } = makeLedger();

    expect(ledger.tryReserve("igdb", 4)).toBe(true);
    expect(ledger.remaining("igdb")).toBe(6);

    ledger.commit("igdb", 4);
    expect(ledger.remaining("igdb")).toBe(6);
  });

  it("release devuelve la reserva no consumida", () => {
    const { ledger } = makeLedger();

    ledger.tryReserve("igdb", 4);
    ledger.release("igdb", 4);

    expect(ledger.remaining("igdb")).toBe(10);
  });

  it("tryReserve falla si no hay saldo suficiente", () => {
    const { ledger } = makeLedger({ igdb: 2, brave: 20, llm: 30 });

    expect(ledger.tryReserve("igdb", 3)).toBe(false);
    expect(ledger.remaining("igdb")).toBe(2);
  });

  it("las reservas bloquean nuevas reservas hasta liberarse", () => {
    const { ledger } = makeLedger({ igdb: 2, brave: 20, llm: 30 });

    expect(ledger.tryReserve("igdb", 2)).toBe(true);
    expect(ledger.tryReserve("igdb", 1)).toBe(false);

    ledger.release("igdb", 2);
    expect(ledger.tryReserve("igdb", 1)).toBe(true);
  });

  it("el contador se reinicia con el cambio de día", () => {
    const { ledger, advanceTo } = makeLedger({ igdb: 2, brave: 20, llm: 30 });

    ledger.tryReserve("igdb", 2);
    ledger.commit("igdb", 2);
    expect(ledger.remaining("igdb")).toBe(0);

    advanceTo(new Date("2026-09-02T00:00:01Z"));
    expect(ledger.remaining("igdb")).toBe(2);
  });
});

import { randomUUID } from "node:crypto";

/*
 * Traza por petición: cada recomendación genera un id corto y escribe
 * líneas "[rec:<id>] ..." en stdout (visibles con docker compose logs).
 * Objetivo: poder diagnosticar cualquier búsqueda leyendo el log, sin
 * depender de adivinanzas sobre qué hizo el orquestador.
 */

export type Trace = (message: string, data?: unknown) => void;

export function newTraceId(): string {
  return randomUUID().slice(0, 8);
}

/*
 * Silencio por defecto bajo Vitest (define VITEST=true en el entorno): el
 * ruido de trazas en la salida de tests enturbia los fallos reales.
 * TMWTP_LOG=on fuerza el logging dentro de tests para depurar un caso.
 */
const enabled =
  process.env.TMWTP_LOG === "on" || process.env.VITEST !== "true";

export function createTrace(traceId: string): Trace {
  return (message: string, data?: unknown) => {
    if (!enabled) return;
    if (data === undefined) {
      console.log(`[rec:${traceId}] ${message}`);
      return;
    }
    try {
      console.log(`[rec:${traceId}] ${message} ${JSON.stringify(data)}`);
    } catch {
      // Datos no serializables: la línea de texto sola ya sirve.
      console.log(`[rec:${traceId}] ${message}`);
    }
  };
}

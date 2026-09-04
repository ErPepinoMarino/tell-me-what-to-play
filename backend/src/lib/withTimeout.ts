// Ejecuta una promesa con tope temporal. La promesa original sigue corriendo
// en segundo plano (V1: no hay AbortSignal en los clientes externos), pero el
// orquestador deja de esperarla y trata la unidad como fallida.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

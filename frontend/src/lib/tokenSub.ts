/*
 * El id del usuario autenticado vive en el sub del JWT del access token.
 * Decodificación client-side (sin firma verificación: solo lectura del
 * payload para saber QUIÉN llama; el backend revalida siempre con el
 * header Authorization).
 */
export function subFromToken(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { sub?: string };
    const sub = Number(json.sub);
    return Number.isInteger(sub) ? sub : null;
  } catch {
    return null;
  }
}

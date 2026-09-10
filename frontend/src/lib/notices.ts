import type { NoticeCode } from "@/types/Recommendation";

/*
 * Textos ES de los avisos del orquestador. Los notices internos
 * (PARTIAL_RESULTS, SEARCH_EXHAUSTED, DISCOVERY_*, CATALOG_FULL, PG_DEGRADED)
 * no se muestran al usuario normal: solo aparecen en el modo demo/técnico.
 * La información útil para el usuario va en los avisos visibles del chat.
 */

export const NOTICE_MESSAGES: Record<NoticeCode, string> = {
  EXPLICIT_GAME_REQUESTED:
    "Esto es Tell Me What To Play: si ya sabes qué juego quieres, no tiene mucho sentido que me lo digas. De todos modos, aquí tienes ese juego y varios parecidos por si quieres añadirlo a tu lista. ;)",
  ANCHOR_NOT_FOUND:
    "No he encontrado ese juego en ningún catálogo; sigo con el resto de tu búsqueda.",
  EMPTY_INTENT:
    "Cuéntame algo más: género, ambiente, dificultad, plataformas...",
  PARTIAL_RESULTS:
    "Esto es lo mejor que he encontrado por ahora; no he llegado a más con la calidad que me gustaría.",
  SEARCH_EXHAUSTED:
    "No queda más por ahora con esta búsqueda. Pídeme más si quieres, o afínala o cambia de tema.",
  INTENT_UNCHANGED:
    "No he entendido nada nuevo en tu mensaje: sigo con la búsqueda que teníamos.",
  REFINE_REQUIRES_LOGIN:
    "He entendido que estás intentando refinar una búsqueda anterior. Desafortunadamente solo los usuarios logueados pueden hacerlo. Puedes iniciar sesión con tu cuenta de Google o hacer una búsqueda nueva desde cero.",
  SENSELESS_INPUT:
    "Solo puedo ayudarte a buscar videojuegos. Cuéntame qué te apetece jugar: género, ambiente, mecánicas, una referencia...",
  DISCOVERY_BUDGET_EXHAUSTED: "Presupuesto diario de descubrimiento agotado.",
  DISCOVERY_UNAVAILABLE: "Descubrimiento de juegos nuevos no disponible.",
  CATALOG_FULL: "El catálogo ha alcanzado su límite.",
  PG_DEGRADED: "Catálogo degradado: resultados limitados al cache local.",
  RELAXED_FILTERS:
    "Tu búsqueda era muy estricta y no daba resultados: he ampliado soltando algún filtro para traerte estos juegos.",
};

// Los que solo interesan en modo demo/técnico. EXPLICIT_GAME_REQUESTED va
// aquí: la fila de juegos de referencia ya comunica el ancla visualmente, y
// el mensaje burlón no encaja en búsquedas "similar a X pero que no sea X".
const INTERNAL_NOTICES: NoticeCode[] = [
  "EXPLICIT_GAME_REQUESTED",
  "PARTIAL_RESULTS",
  "SEARCH_EXHAUSTED",
  "DISCOVERY_BUDGET_EXHAUSTED",
  "DISCOVERY_UNAVAILABLE",
  "CATALOG_FULL",
  "PG_DEGRADED",
];

export function visibleNotices(
  notices: NoticeCode[],
  demoMode: boolean
): NoticeCode[] {
  return notices.filter(
    (notice) => demoMode || !INTERNAL_NOTICES.includes(notice)
  );
}

/*
 * Nombres en español de los grupos de requisitos que la criba relajada
 * puede soltar (meta.relaxedFilters del backend). Para decirle al usuario
 * QUÉ se quitó, no solo que se quitó algo.
 */
export const RELAXED_FILTER_LABELS: Record<string, string> = {
  years: "año",
  perspectives: "perspectiva",
  platforms: "plataforma",
  gameModes: "modo de juego",
  themes: "ambientación",
  genres: "género",
  keywords: "temática",
};

export function relaxedFiltersMessage(groups: string[]): string {
  const labels = groups.map((group) => RELAXED_FILTER_LABELS[group] ?? group);
  if (labels.length === 0) return NOTICE_MESSAGES.RELAXED_FILTERS;
  if (labels.length === 1)
    return `Tu búsqueda era muy estricta y no daba resultados: he quitado el filtro de ${labels[0]} para traerte estos juegos.`;
  const last = labels[labels.length - 1];
  return `Tu búsqueda era muy estricta y no daba resultados: he quitado los filtros de ${labels.slice(0, -1).join(", ")} y ${last} para traerte estos juegos.`;
}

import type { NoticeCode } from "@/types/Recommendation";

/*
 * Textos ES de los avisos del orquestador. Los notices internos
 * (DISCOVERY_*, CATALOG_FULL, PG_DEGRADED) no se muestran al usuario
 * normal: solo aparecen en el modo demo/técnico.
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
  REFINE_WITHOUT_CONTEXT:
    "Aún no había ninguna búsqueda que afinar: he tratado tu mensaje como una búsqueda nueva.",
  DISCOVERY_BUDGET_EXHAUSTED: "Presupuesto diario de descubrimiento agotado.",
  DISCOVERY_UNAVAILABLE: "Descubrimiento de juegos nuevos no disponible.",
  CATALOG_FULL: "El catálogo ha alcanzado su límite.",
  PG_DEGRADED: "Catálogo degradado: resultados limitados al cache local.",
};

// Los que solo interesan en modo demo/técnico.
export const INTERNAL_NOTICES: NoticeCode[] = [
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

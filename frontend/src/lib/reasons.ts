import type { GameSearchIntent, MatchReason, MatchTier } from "@/types/Recommendation";

/*
 * Humanización de los datos deterministas del matcher. El backend manda
 * vocabulario técnico estable (block + field + kind + note); el frontend
 * es dueño de la presentación en español.
 */

export const SEMANTIC_LABELS: Record<string, string> = {
  difficulty: "Dificultad",
  pace: "Ritmo pausado",
  narrative: "Narrativa",
  complexity: "Complejidad",
  coziness: "Ambiente acogedor",
  strategy: "Estrategia",
  exploration: "Exploración",
  violence: "Violencia",
  horror: "Horror",
  darkness: "Tono oscuro",
  tension: "Tensión",
  humor: "Humor",
  isolation: "Aislamiento",
};

const GENRE_LABELS: Record<string, string> = {
  ACTION: "Acción",
  ADVENTURE: "Aventura",
  ARCADE: "Arcade",
  CASUAL: "Casual",
  FIGHTING: "Lucha",
  HORROR: "Horror",
  INDIE: "Indie",
  MMO: "MMO",
  PLATFORMER: "Plataformas",
  PUZZLE: "Puzzle",
  RACING: "Carreras",
  RPG: "RPG",
  SHOOTER: "Shooter",
  SIMULATION: "Simulación",
  SPORTS: "Deportes",
  STRATEGY: "Estrategia",
  VISUAL_NOVEL: "Novela visual",
  UNKNOWN: "Sin clasificar",
};

const MODE_LABELS: Record<string, string> = {
  SINGLE_PLAYER: "Un jugador",
  MULTIPLAYER: "Multijugador",
  COOPERATIVE: "Cooperativo",
  COMPETITIVE: "Competitivo",
  UNKNOWN: "Sin clasificar",
};

const PERSPECTIVE_LABELS: Record<string, string> = {
  FIRST_PERSON: "Primera persona",
  THIRD_PERSON: "Tercera persona",
  TOP_DOWN: "Vista cenital",
  ISOMETRIC: "Isométrica",
  SIDE_VIEW: "Vista lateral",
  TEXT: "Texto",
  UNKNOWN: "Sin clasificar",
};

export const TIER_LABELS: Record<MatchTier, string> = {
  excellent: "Match excelente",
  valid: "Buen match",
  weak: "Match débil",
  invalid: "No recomendable",
};

export interface ReasonChip {
  icon: "check" | "partial" | "cross";
  label: string;
  detail?: string;
}

function semanticLabel(field: string): string {
  return SEMANTIC_LABELS[field] ?? field;
}

/*
 * Convierte una razón del matcher en un chip comprensible.
 * La temática (keywords) se muestra siempre primero: es el bloque que
 * domina el score según la calibración.
 */
export function reasonToChip(reason: MatchReason): ReasonChip | null {
  if (reason.kind === "skipped") return null;

  const chip = ((): ReasonChip | null => {
    switch (reason.note) {
      case "keyword-match":
        return {
          icon: "check",
          label: `Temática: ${reason.field.replace(/^kw\./, "")}`,
        };
      case "semantic-agreement":
        return {
          icon: "partial",
          label: `${semanticLabel(reason.field)} coincide`,
        };
      case "amplified-contradiction":
        return {
          icon: "cross",
          label: `${semanticLabel(reason.field)} contradice lo pedido`,
        };
      case "must-violated":
        return { icon: "cross", label: "No cumple un requisito pedido" };
      case "red-flag-violated":
        return { icon: "cross", label: "Contiene algo que excluiste" };
      case "absence-violated":
        return {
          icon: "cross",
          label: `Tiene ${semanticLabel(reason.field).toLowerCase()} cuando pedías evitarlo`,
        };
      default:
        return null;
    }
  })();

  if (!chip) return null;
  return chip;
}

export function reasonsToChips(reasons: MatchReason[]): ReasonChip[] {
  return reasons
    .map(reasonToChip)
    .filter((chip): chip is ReasonChip => chip !== null);
}

/*
 * Resumen ES de la intención interpretada, para el "he entendido: ..." del
 * chat. Espejo ligero del describeIntent del backend.
 */
export function intentSummary(intent: GameSearchIntent): string[] {
  const bits: string[] = [];

  const genres = intent.objective?.genres?.filter((g) => g !== "UNKNOWN") ?? [];
  if (genres.length > 0) {
    bits.push(genres.map((g) => GENRE_LABELS[g] ?? g).join(" / "));
  }

  const modes = intent.objective?.gameModes?.filter((m) => m !== "UNKNOWN") ?? [];
  if (modes.length > 0) {
    bits.push(modes.map((m) => MODE_LABELS[m] ?? m).join(" / "));
  }

  const perspectives =
    intent.objective?.perspectives?.filter((p) => p !== "UNKNOWN") ?? [];
  if (perspectives.length > 0) {
    bits.push(perspectives.map((p) => PERSPECTIVE_LABELS[p] ?? p).join(" / "));
  }

  const platforms = intent.objective?.platforms?.filter((p) => p !== "UNKNOWN") ?? [];
  if (platforms.length > 0) {
    bits.push(`en ${platforms.join(" / ")}`);
  }

  if (intent.keywords && intent.keywords.length > 0) {
    // Las keywords son vocabulario interno de búsqueda (inglés canónico):
    // se etiquetan como lo que son en vez de mezclarse con los labels ES.
    bits.push(`términos de búsqueda: ${intent.keywords.join(", ")}`);
  }

  if (intent.releaseYear !== null) {
    bits.push(`del año ${intent.releaseYear}`);
  } else if (intent.yearFrom !== null && intent.yearTo !== null) {
    bits.push(`entre ${intent.yearFrom} y ${intent.yearTo}`);
  } else if (intent.yearFrom !== null) {
    bits.push(`desde ${intent.yearFrom}`);
  } else if (intent.yearTo !== null) {
    bits.push(`hasta ${intent.yearTo}`);
  }

  if (intent.gameReferenced && intent.gameReferenced.length > 0) {
    bits.push(`referencia: ${intent.gameReferenced.join(", ")}`);
  }

  const exclusions = [
    ...(intent.excluded?.keywords ?? []),
    ...(intent.excluded?.genres ?? []),
    ...(intent.excluded?.platforms ?? []),
  ];
  if (exclusions.length > 0) {
    bits.push(`sin: ${exclusions.join(", ")}`);
  }

  if (intent.semantic) {
    for (const [field, value] of Object.entries(intent.semantic)) {
      if (value === null || value === undefined) continue;
      if (value >= 0.6) bits.push(`muy ${SEMANTIC_LABELS[field] ?? field}`);
      else if (value > 0 && value < 0.4)
        bits.push(`poco ${SEMANTIC_LABELS[field] ?? field}`);
      else if (value === 0)
        bits.push(`sin ${SEMANTIC_LABELS[field] ?? field}`);
    }
  }

  return bits;
}

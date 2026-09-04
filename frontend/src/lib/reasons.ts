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

function objectiveLabel(field: string): string {
  // "genres.RPG" | "gameModes.COOPERATIVE" | "perspectives.TOP_DOWN"
  const [prefix, value] = field.split(".");
  if (prefix === "genres") return GENRE_LABELS[value] ?? value;
  if (prefix === "gameModes") return MODE_LABELS[value] ?? value;
  if (prefix === "perspectives") return PERSPECTIVE_LABELS[value] ?? value;
  return field;
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
      case "reference-keyword":
        return {
          icon: "check",
          label: `Similar a lo que pediste: ${reason.field.replace(/^ref\./, "")}`,
        };
      case "genre-match":
        return { icon: "check", label: `Género: ${objectiveLabel(reason.field)}` };
      case "mode-match":
        return { icon: "check", label: objectiveLabel(reason.field) };
      case "perspective-match":
        return { icon: "check", label: objectiveLabel(reason.field) };
      case "platform-overlap":
        return { icon: "check", label: "Disponible en tus plataformas" };
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
      case "no-overlap":
        return {
          icon: "cross",
          label:
            reason.field === "genres"
              ? "No es del género pedido"
              : "No tiene los modos de juego pedidos",
        };
      case "no-keyword-overlap":
        return { icon: "cross", label: "No encaja con la temática pedida" };
      case "no-reference-overlap":
        return {
          icon: "cross",
          label: "Poca relación con el juego de referencia",
        };
      case "platforms-disjoint":
        return { icon: "cross", label: "No está en tus plataformas" };
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

  if (intent.keywords && intent.keywords.length > 0) {
    bits.push(intent.keywords.join(", "));
  }

  if (intent.gameReferenced && intent.gameReferenced.length > 0) {
    bits.push(`referencia: ${intent.gameReferenced.join(", ")}`);
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

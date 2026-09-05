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
  ADVENTURE: "Aventura",
  ARCADE: "Arcade",
  CARD_AND_BOARD_GAME: "Cartas y tablero",
  FIGHTING: "Lucha",
  HACK_AND_SLASH_BEAT_EM_UP: "Hack & slash",
  INDIE: "Indie",
  MOBA: "MOBA",
  MUSIC: "Música",
  PINBALL: "Pinball",
  PLATFORM: "Plataformas",
  POINT_AND_CLICK: "Point & click",
  PUZZLE: "Puzzle",
  QUIZ_TRIVIA: "Trivial",
  RACING: "Carreras",
  REAL_TIME_STRATEGY: "Estrategia en tiempo real",
  ROLE_PLAYING_RPG: "RPG",
  SHOOTER: "Shooter",
  SIMULATOR: "Simulación",
  SPORT: "Deportes",
  STRATEGY: "Estrategia",
  TACTICAL: "Táctico",
  TURN_BASED_STRATEGY: "Estrategia por turnos",
  VISUAL_NOVEL: "Novela visual",
  UNKNOWN: "Sin clasificar",
};

// Themes de IGDB: mundo/tono/ambientación (capa MUST del intent).
const THEME_LABELS: Record<string, string> = {
  ACTION: "Acción",
  BUSINESS: "Negocios",
  COMEDY: "Comedia",
  DRAMA: "Drama",
  EDUCATIONAL: "Educativo",
  EROTIC: "Erótico",
  FANTASY: "Fantasía",
  FOUR_X: "4X",
  HISTORICAL: "Histórico",
  HORROR: "Terror",
  KIDS: "Infantil",
  MYSTERY: "Misterio",
  NON_FICTION: "No ficción",
  OPEN_WORLD: "Mundo abierto",
  PARTY: "Fiesta",
  ROMANCE: "Romance",
  SANDBOX: "Sandbox",
  SCIENCE_FICTION: "Ciencia ficción",
  STEALTH: "Sigilo",
  SURVIVAL: "Supervivencia",
  THRILLER: "Thriller",
  WARFARE: "Guerra",
  UNKNOWN: "Sin clasificar",
};

const MODE_LABELS: Record<string, string> = {
  SINGLE_PLAYER: "Un jugador",
  MULTIPLAYER: "Multijugador",
  COOPERATIVE: "Cooperativo",
  COMPETITIVE: "Competitivo",
  MASSIVELY_MULTIPLAYER: "MMO",
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
 * Resumen ES de la intención interpretada, para el "He entendido: ..." del
 * chat. Espejo ligero del describeIntent del backend. Devuelve CHIPS
 * estructurados (etiqueta + tono) para renderizar como tags: verde (++ lo
 * demandado fuerte), rojo (-- ausencias y exclusiones), neutro (temas,
 * géneros, plataformas, años).
 */
export interface IntentChip {
  label: string;
  tone: "positive" | "negative" | "neutral";
}

export function intentSummaryChips(intent: GameSearchIntent): IntentChip[] {
  const chips: IntentChip[] = [];

  const genres = intent.objective?.genres?.filter((g) => g !== "UNKNOWN") ?? [];
  for (const genre of genres) {
    chips.push({ label: GENRE_LABELS[genre] ?? genre, tone: "neutral" });
  }

  const themes = intent.objective?.themes?.filter((t) => t !== "UNKNOWN") ?? [];
  for (const theme of themes) {
    chips.push({ label: THEME_LABELS[theme] ?? theme, tone: "neutral" });
  }

  const modes = intent.objective?.gameModes?.filter((m) => m !== "UNKNOWN") ?? [];
  for (const mode of modes) {
    chips.push({ label: MODE_LABELS[mode] ?? mode, tone: "neutral" });
  }

  const perspectives =
    intent.objective?.perspectives?.filter((p) => p !== "UNKNOWN") ?? [];
  for (const perspective of perspectives) {
    chips.push({
      label: PERSPECTIVE_LABELS[perspective] ?? perspective,
      tone: "neutral",
    });
  }

  const platforms = intent.objective?.platforms?.filter((p) => p !== "UNKNOWN") ?? [];
  for (const platform of platforms) {
    chips.push({ label: platform, tone: "neutral" });
  }

  for (const keyword of intent.keywords ?? []) {
    chips.push({ label: keyword, tone: "neutral" });
  }

  if (intent.releaseYear !== null) {
    chips.push({ label: `del año ${intent.releaseYear}`, tone: "neutral" });
  } else if (intent.yearFrom !== null && intent.yearTo !== null) {
    chips.push({ label: `entre ${intent.yearFrom} y ${intent.yearTo}`, tone: "neutral" });
  } else if (intent.yearFrom !== null) {
    chips.push({ label: `desde ${intent.yearFrom}`, tone: "neutral" });
  } else if (intent.yearTo !== null) {
    chips.push({ label: `hasta ${intent.yearTo}`, tone: "neutral" });
  }

  if (intent.gameReferenced && intent.gameReferenced.length > 0) {
    chips.push({
      label: `similar a ${intent.gameReferenced.join(", ")}`,
      tone: "neutral",
    });
  }

  if (intent.semantic) {
    for (const [field, value] of Object.entries(intent.semantic)) {
      if (value === null || value === undefined) continue;
      const label = SEMANTIC_LABELS[field] ?? field;
      if (value >= 0.7) chips.push({ label: `++ ${label}`, tone: "positive" });
      else if (value === 0) chips.push({ label: `-- ${label}`, tone: "negative" });
      else if (value < 0.4) chips.push({ label: `poco ${label}`, tone: "neutral" });
    }
  }

  const exclusions = [
    ...(intent.excluded?.keywords ?? []),
    ...(intent.excluded?.genres ?? []),
    ...(intent.excluded?.themes ?? []),
    ...(intent.excluded?.platforms ?? []),
  ];
  for (const excluded of exclusions) {
    chips.push({ label: `-- sin ${excluded}`, tone: "negative" });
  }

  return chips;
}

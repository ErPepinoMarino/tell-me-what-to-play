import { EPSILON, TIER_RANK } from "./constants.js";
import { isAnchorGame, matchGame } from "./matchGame.js";
import type {
  ExcludedGame,
  MatchableGame,
  RankOptions,
  RankResult,
  RankedMatch,
} from "./types.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

/*
 * Ranking por lotes: matchea cada juego, aplica exclusiones (mostrados en
 * sesión, anclas, duplicados de entrada) y ordena de forma determinista.
 * Devuelve TODOS los tiers: decidir qué mostrar y cuándo buscar más es
 * responsabilidad del orquestador, no de este módulo.
 */
export function rankMatches<T extends MatchableGame>(
  intent: GameSearchIntent,
  games: T[],
  options: RankOptions = {},
): RankResult<T> {
  const anchors = options.anchors ?? [];
  const shownIds = new Set(options.excludeGameIds ?? []);
  const excludeReferenced = options.excludeReferenced ?? true;

  const ranked: RankedMatch<T>[] = [];
  const excluded: ExcludedGame[] = [];
  const seenSlugs = new Set<string>();

  for (const game of games) {
    // Orden de exclusión fijo: mostrados → anclas → duplicados.
    if (shownIds.has(game.id)) {
      excluded.push({
        gameId: game.id,
        slug: game.slug,
        reason: "already-shown",
      });
      continue;
    }
    if (excludeReferenced && isAnchorGame(game, anchors)) {
      excluded.push({
        gameId: game.id,
        slug: game.slug,
        reason: "referenced-anchor",
      });
      continue;
    }
    if (seenSlugs.has(game.slug)) {
      excluded.push({
        gameId: game.id,
        slug: game.slug,
        reason: "duplicate-input",
      });
      continue;
    }
    seenSlugs.add(game.slug);
    ranked.push({ ...matchGame({ intent, game, anchors }), game });
  }

  ranked.sort(compareRankedMatches);
  return { ranked, excluded };
}

// tier desc → score desc → cobertura semántica desc → slug asc (codepoints).
// El tier VA PRIMERO: un candidato que falla filtros (invalid) nunca compite
// con uno que los pasa, aunque su acuerdo semántico sea mayor.
function compareRankedMatches(a: RankedMatch, b: RankedMatch): number {
  const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
  if (tierDiff !== 0) return tierDiff;
  if (Math.abs(a.score - b.score) > EPSILON) return b.score - a.score;
  if (a.coverage.semanticDims !== b.coverage.semanticDims) {
    return b.coverage.semanticDims - a.coverage.semanticDims;
  }
  if (a.game.slug !== b.game.slug) {
    return a.game.slug < b.game.slug ? -1 : 1;
  }
  return 0;
}

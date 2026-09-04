# Plan: Matcher con filtros duros ("must" + red flags) y calidad de catálogo

Aprobado por el usuario (elegir "Ejecutar plan completo"). Decisión de producto:

- TODO elemento no-semántico pedido explícitamente es filtro duro (must): keywords (todas), géneros, plataformas, gameModes, perspectivas, año exacto y rangos. Superset permitido (más de lo pedido no penaliza); UNKNOWN = no verificable = falla.
- Red flags (`excluded.*`): cualquier candidato que los contenga queda excluido SIEMPRE, aunque sea ideal (ej. GTA). Matching por talo en keywords O palabra en título; prompt obliga a expandir siglas de franquicias ("gta" → ["gta", "grand theft auto"]).
- Ranking: SOLO semántica — score = media de acuerdo sobre dims comparables (amplificación acuerdo² si distancia ≥ 0.5), coverage = comparables/13 como desempate, slug final. MATCH_WEIGHTS/OBJ_SUBWEIGHTS/PLATFORM_BONUS/ZERO_OVERLAP_PENALTIES/banda k/s y bloques objective/keywords/reference DESAPARECEN del scoring. Tiers: excellent (score ≥ 0.75 y cov ≥ 0.5), valid el resto, invalid solo por gates. weak queda inactivo.
- 2d/3d/pixel art → keywords (vocabulario IGDB); solo vistas nombradas → perspectives.
- Año exacto + rangos (yearFrom/yearTo) tanto en must como en red flags.
- Discovery: no persistir fichas cuyo enrichment no aporte ninguna semántica ni keywords nuevas; minIgdbRatingCount 2 → 3.
- Backfill del catálogo (fichas del seed sin source_id/semánticas/portada) + reEnrich con fallback por título.

## Fase A — Contrato (backend + espejo frontend)
- `backend/src/types/GameSearchIntent.ts`: añadir `releaseYear/yearFrom/yearTo: number|null` y `excluded: { keywords, genres, platforms, gameModes, perspectives, releaseYear, yearFrom, yearTo } | null` (todo nullable, zod).
- `frontend/src/types/Recommendation.ts`: espejo de GameSearchIntent.

## Fase B — Matcher reescrito
- `backend/src/matching/types.ts`: `MatchableGame` añade `title: string` y `releaseYear: number|null`; `MatchResult` pierde `blockScores` (BlockScores fuera); MatchCoverage/MatchReason/MatchBlock se conservan (DTO estable).
- `backend/src/matching/constants.ts`: conservar SEMANTIC_FIELDS, TIER_RANK, EPSILON, SCORE_MIN/MAX, AMPLIFICATION_THRESHOLD, AGREEMENT_BONUS_THRESHOLD, ABSENCE_GATE_MIN, COV_MIN.excellent, MATCH_THRESHOLDS.excellent; nuevos `GATE_MUST_VIOLATED = "must-violated"`, `GATE_RED_FLAG_VIOLATED = "red-flag-violated"`; eliminar MATCH_WEIGHTS, OBJ_SUBWEIGHTS, PLATFORM_BONUS, ZERO_OVERLAP_PENALTIES, thresholds valid/weak, COV_MIN.valid, GATE_PLATFORMS_DISJOINT.
- `backend/src/matching/matchGame.ts` (reescritura completa):
  - Helpers: `titleWordStems(title)` (split + keywordStem), `termMatches(term, keywordStems, titleStems)` = talo completo en keywords O todas las palabras del término presentes en el título.
  - `checkRedFlags`: excluded.keywords (termMatches), excluded.enums (presente en el juego), excluded años (exacto/from/to vs game.releaseYear) → gate red-flag-violated.
  - `checkMust`: TODAS las keywords (termMatches), cada valor pedido de genres/platforms/gameModes/perspectives presente (grupo con UNKNOWN → must-violated), releaseYear exacto y rango (game null → falla) → gate must-violated.
  - Absence gate semántico (intent 0 explícito, ABSENCE_GATE_MIN) se conserva.
  - Ranking semántico: por dim comparable, agreement = 1 − |intent − game| (amplificado al cuadrado si distancia ≥ 0.5); contribution = agreement; score = clamp(Σ contributions); reason kind bonus/penalty según AGREEMENT_BONUS_THRESHOLD, note amplified-contradiction si toca.
  - Reasons informativos de keywords matcheadas: block keywords, contribution 0, kind bonus, note keyword-match.
  - Coverage: semanticDims = comparables; objectiveFields = nº de grupos objetivo con datos conocidos del juego; hasKeywords; hasAnchors.
  - Tiers: gates > 0 → invalid; score ≥ 0.75 && cov ≥ 0.5 → excellent; resto valid.
- `backend/src/matching/rankMatches.ts`: sin cambios (exclusiones shown/anchor/dupes + orden score desc → tier → coverage.semanticDims → slug).
- `backend/src/orchestrator/recommendationOrchestrator.ts`: `topReasons` — filtrar solo kind "skipped" (los bonus a contribución 0 se muestran tras los con contribución), sort |contribution| desc, slice 3.
- `backend/src/orchestrator/candidates.ts`: `buildPoolFilter` AND — añade releaseYear/yearFrom/yearTo al filtro.
- `backend/src/repositories/prismaGameRepository.ts`: `findCandidates` AND: `AND: [...keywords.map(k => ({ keywords: { has: k } })), ...genres.map(g => ({ genres: { has: g } })), ...platforms…]` + release_year igual/gte/lte; sin filtros → undefined.
- `backend/src/orchestrator/recommendationOrchestrator.ts`: `isEmptyIntent` incluye hasYear (releaseYear/yearFrom/yearTo) y NO cuenta `excluded` (intención solo-exclusiones → EMPTY_INTENT).

## Fase C — Intérprete y discovery
- `backend/src/services/intentService.ts` (instructions + refine):
  - Regla de contrato: todo campo rellenado es requisito duro; rellenar SOLO lo explícito.
  - "2d"/"3d"/"pixel art" → keywords; vistas nombradas → perspectives.
  - Año: "del 2004" → releaseYear; "de los 90" → yearFrom/yearTo; "anteriores a 2010" → yearTo; "posteriores a 2015" → yearFrom.
  - "que no sea X / sin X / anything but X" → excluded.* con normalización canónica y expansión de siglas/franquicias ("not GTA" → excluded.keywords ["gta","grand theft auto"]).
  - "similar a X pero que no sea X" → gameReferenced ["X"] + excluded (keywords con sigla y nombre completo).
- `backend/src/orchestrator/discovery.ts`: tras enrich exitoso, si `SEMANTIC_FIELDS.some(f => enriched[f] !== null)` es false Y `enriched.keywords.length <= candidate.keywords.length` → NO crear la ficha (commit presupuesto + log + continue); `minIgdbRatingCount` 2 → 3 en `recommendation/constants.ts`.
- `backend/src/orchestrator/discovery.ts` reEnrich: quitar el `if (!game.sourceId) return skipped`; matching del raw por sourceId, slug O título normalizado exacto; cuando game.sourceId es null, fusionar también datos objetivo del candidato (sourceId, géneros, plataformas, modos, perspectivas, coverUrl si null, releaseYear) + keywords (merge) + semánticas (conservar conocidas).

## Fase D — Backfill
- `backend/scripts/enrichBackfill.ts` + script npm `enrich:backfill`: importa `./env.js`, `prismaCatalogLayer` (orchestrator/adapters), `createIgdbClient`, `createEnrichmentService`, `InMemoryBudgetLedger` con límites diarios; recorre `getAll()` filtrando (sourceId null || knownSemanticsCount < 7) y llama `reEnrich`; reporta updated/skipped/not-found/error.
- Tras ejecutarlo: regenerar `games_seed.json` (update en sitio de las 20 entradas desde PG: keywords/coverUrl/releaseYear/sourceId/genres) y `frontend/src/data/games.ts` con `npm run import-games` (frontend).

## Fase E — Frontend
- `frontend/src/types/Recommendation.ts`: GameSearchIntent espejo (campos nuevos).
- `frontend/src/lib/reasons.ts`: mapeo de notas `must-violated` y `red-flag-violated` a chips ✗ (no se mostrarán en resultados, pero el vocabulario queda cubierto).

## Fase F — Tests
- `tests/helpers/fakes.ts`: makeIntent con campos nuevos (null por defecto); makeGame ya tiene title/releaseYear.
- `tests/lib/matching/`: reescribir golden/calibration → suites nuevas: filtros must (superset, UNKNOWN falla, año/rangos), red flags (GTA por título, enums, año), ranking semántico puro (amplificación, desempates, invariante score = Σ contributions), determinismo. keywords.test se mantiene.
- `tests/services/`: queryVariants (sin cambios esperados), orchestrator (PIRATES_INTENT etc. con nuevos campos por makeIntent; añadir casos must/red-flag), discovery (no persistir enrichment vacío, gate 3, reEnrich por título para fichas sin source_id), intentService (reglas del prompt).
- `tests/e2e/recommendations.e2e.test.ts`: DEFAULT_INTENT del mock con campos nuevos (null).

## Verificación
1. `npx vitest run --config vitest.smoke.config.ts` (unit completo).
2. Suite completa con Postgres levantado (docker compose up -d postgres).
3. `npm run lint` + `npm run build` (backend y frontend).
4. Ejecutar `npm run enrich:backfill` (presupuesto: ~20 IGDB + 40 Brave + 20 LLM).
5. Regenerar seed JSON + games.ts.
6. `docker compose up -d --build backend frontend` y probar: "ps2 accion 2004 oscuro y rapido", "similar a god of war pero que no sea god of war", "hack and slash", "psp", portadas reales del seed.

## Notas
- Trade-off asumido: búsquedas muy específicas pueden dar 0 resultados honestos (notices) hasta que discovery/backfill llenen catálogo.
- reEnrich por título también beneficia al crecimiento orgánico.
- El backfill reutiliza reEnrich: una sola implementación de "nunca degradar ficha conocida".

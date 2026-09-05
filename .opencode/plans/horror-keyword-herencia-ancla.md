# Plan: horror-como-keyword + herencia de ancla + backfill + UX chat

Decisiones del usuario: HORROR fuera del enum (keyword como must); ancla → géneros
must + semánticas ranking (cap 0.8) + overlap de keywords (≥ 1, no todas); backfill
completo; ejecutar A-F.

## 1. HORROR fuera del enum Genre (artefacto del seed; IGDB lo tiene como theme)
- Migración Prisma con data-migration (editando el SQL generado):
  1) UPDATE games SET keywords = array_append(keywords,'horror') WHERE 'HORROR' = ANY(genres);
  2) UPDATE games SET genres = array_remove(genres,'HORROR');
  3) ALTER TYPE "Genre" REMOVE VALUE 'HORROR';
- `schema.prisma`: quitar HORROR del enum Genre.
- `GameSearchIntent.ts` (zod) y `matching` types: quitar HORROR de las uniones.
- `normalizers.ts`: quitar "Horror": "HORROR" de GENRE_MAP (los themes ya van a keywords).
- Seed: si `games_seed.json`/`games.ts` tienen HORROR en genres → mover a keywords
  (gamesData.test valida).
- Frontend: union Genre sin HORROR; GENRE_LABELS sin la entrada.

## 2. Prompt (`intentService.ts`)
- "de terror" → keywords ["horror"] + semantic horror (NO género HORROR).
- Caso literal GoW: "algo similar a god of war pero que no sea god of war" →
  gameReferenced ["God of War"] + excluded.keywords ["god of war"] + nada más.

## 3. Herencia de perfil del ancla + gate de overlap (`recommendationOrchestrator.ts` + `matchGame.ts`)
- Orchestrator (tras resolver anclas): si `intent.keywords` vacío && semantic null &&
  objective null && anchors.length > 0 → heredar del PRIMER ancla:
  - objective.genres = anchor.genres (must: "mismos géneros")
  - semantic = perfil NO-null del ancla, cada valor capado a min(valor, 0.8)
    (solo ranking — por debajo del gate de presencia 0.9)
  - keywords = null (el problema "kratos" lo resuelve el gate de overlap)
  - traza "anchor-profile-inherited"
- matchGame: NUEVO gate `anchor-overlap` cuando anchors.length > 0: el candidato
  debe compartir ≥ 1 keyword (talo) con algún ancla ("keywords en común"; "kratos"
  no exigido). Sin keywords en el ancla → gate omitido.
- Tests: similar-a-GoW (hereda géneros ACTION/ADVENTURE + perfil; el ancla excluido;
  un juego sin overlap → invalid; la franquicia excluida por red flag si viene).

## 4. Backfill completo de semánticas (recuperación de la limpieza 0.5)
- `npm run enrich:backfill` SIN filtro de slug: ~170 fichas con < 7 semánticas
  conocidas → re-enrich con el prompt endurecido (evidencia o null, sin 0.5).
- Informe después: cuántas con semánticas regrow, cuántas null.

## 5. Frontend UX
- `AIChat.tsx`: ocultar chips del resumen cuando notices incluya INTENT_UNCHANGED.
- `RecommendationSection.tsx`: mensaje del usuario OPTIMISTA al enviar (push antes
  del fetch; el assistant se añade al llegar la respuesta o el error).
- `globals.css`: `.chat` con max-height + overflow-y auto (scroll, no crecimiento).
- `notices.ts`: EXPLICIT_GAME_REQUESTED → INTERNAL_NOTICES (solo demo; la fila de
  anclas ya comunica).

## 6. Verificación
1. Migración aplicada (enum sin HORROR, keywords "horror" en las fichas afectadas).
2. tsc + smoke + lint + builds.
3. Suite completa (docker parado para auth).
4. Backfill + informe.
5. Usuario: rebuild docker + re-test (zombies, infectados, terror 3d filtrado,
   similar-a-GoW con herencia, cozy con pool real, chips, scroll del chat).

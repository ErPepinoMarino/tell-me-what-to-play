# Plan: fixes post-test 2ª batería (A-E)

Decisiones: null semántico = fuera; umbrales 0.7 (demanda) / 0.5 (aprobado); ejecutar A-E.

## A. Prompt anti-inferencia (`intentService.ts` — PRERREQUISITO del gate)
- Regla nueva: "A THEME or FRANCHISE never implies a genre or semantic attribute.
  'un juego de zombies' → genres: null, semantic: null, keywords: ['zombies'].
  Genres/semantics ONLY when the user names them explicitly ('de terror' →
  HORROR + horror; 'cozy' → coziness)."
- Caso real añadido como ejemplo (zombies→HORROR fue la causa del 0).

## B. Gate de presencia semántica (`matchGame.ts` + `constants.ts`)
- constants: `SEMANTIC_DEMAND_GATE_MIN = 0.7`, `SEMANTIC_PASS_MIN = 0.5`,
  `GATE_PRESENCE_VIOLATED = "presence-violated"`.
- `checkPresenceGate`: por cada dimensión con intent ≥ 0.7:
  game null O game < 0.5 → gate (razón kind gate, block semantic).
  (Simétrico al gate de ausencia existente; demandas medias solo rankean.)
- Integrado en matchGame (fase filtro) Y en `passesHardFilters`.
- NUEVA opción `passesHardFilters(intent, game, { semanticGates })`:
  - discovery pre-filtro → `semanticGates: false` (los candidatos PRE-enrichment
    tienen semánticas null por diseño; sin esta excepción ningún candidato
    pasaría un intent con semántica demandada).
  - El candidato se evalúa de nuevo tras el enrich: si sigue fallando el gate
    de presencia con las semánticas REALES → NO se persiste (coherente con
    "no almacenar condenados"). `gatherCandidates` usa gates completos.
- Tests: fixture golden (presence-violated: null / 0.4 → invalid; 0.5/1 → valid;
  demanda 0.5 → sin gate) + test de calibración con el ejemplo numérico del
  usuario (cozy 1: quedan cozy 1 y 0.5; fuera 0.4, 0.1, 0, null).

## C. Frontend — chips de intención
- `reasons.ts`: `intentSummary` → `intentSummaryChips(intent): { label, tone }[]`
  (tone: "positive" para demandas fuertes "++", "negative" para ausencias/0 "--",
  "neutral" para géneros/plataformas/keywords/años/exclusiones).
- `AIChat.tsx`: renderizar chips (`<span class="intent-chip intent-chip-{tone}">`)
  en vez de `summary.join(" · ")`.
- `globals.css`: estilos `.intent-chip` (verde/rojo/neutro) reutilizando el
  lenguaje visual de reason-chip.

## D. Explicación sin notices de pipeline (`explanationService.ts` + orquestador)
- `composeResponse`: filtrar PARTIAL_RESULTS/SEARCH_EXHAUSTED del
  `explanationInput.notices` (el explicador habla de los resultados, no del
  estado del pipeline; la guía del usuario es el mensaje de anónimos).
- `fallbackExplanation`: quitar la frase "Por ahora no queda más con esta
  búsqueda" (meta.exhaustedPool).

## E. Verificación
1. tsc + smoke + lint + builds.
2. Suite completa (con docker parado si interfiere).
3. Usuario: rebuild docker + re-test (zombies, infectados, cozy+dame más,
   zombies oscuro asfixiante).

## Fuera de alcance (siguiente ronda, ya aprobada)
- IGDB filtrado (consultas where por atributos con IDs).

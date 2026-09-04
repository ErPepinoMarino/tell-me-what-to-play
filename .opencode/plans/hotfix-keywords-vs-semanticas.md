# Plan hotfix: ERROR 1 (mix idiomas) + ERROR 2 (0 resultados horror 3d)

Aprobado. Diagnóstico verificado en código/logs (ver conversación).

## 1. Prompt del intérprete — clasificación keywords vs semánticas (raíz)
- `backend/src/services/intentService.ts` (instructions + refine):
  - keywords = temas/estilos/fórmulas BUSCABLES en catálogos ("pirates", "hack and slash", "pixel art", "3d", "zombies").
  - Estados de ánimo/atmósfera → SEMÁNTICAS (darkness, isolation, tension, coziness…), NUNCA keywords.
  - Contraejemplo explícito: "oscuro, asfixiante, de terror en 3d" →
    keywords ["3d"], genres ["HORROR"], semantic darkness 1, isolation 1, tension 1,
    coziness 0 — SIN "dark"/"claustrophobic" en keywords.

## 2. Discovery con pre-filtro must (no gastar en condenados)
- `backend/src/orchestrator/discovery.ts`: `discoverByQuery(query, maxNew, traceId, intent?)` —
  tras `seedQueryKeywords`, construir MatchableGame mínimo del Candidate (id 0, semánticas null)
  y correr el filtro duro; si hay gates → skip + log `discovery-skip-must` ANTES de
  existsInCatalog y de reservar Brave/LLM.
- Orquestador: pasar `base.intent` en las llamadas de FILL y orgánicas.
- Trade-off asumido: un juego que falla el must de ESTA búsqueda no se almacena;
  si encaja en búsquedas futuras, se redescubre entonces con las keywords correctas.

## 3. Nueva exportación del matcher
- `backend/src/matching/matchGame.ts`: `export function passesHardFilters(intent, game): boolean`
  (checkRedFlags + checkMust + checkAbsence sin ranking). Reutilizada por discovery y gatherCandidates.

## 4. gatherCandidates — cache filtrada
- `backend/src/orchestrator/candidates.ts`: la cache canonicalizada pasa
  `passesHardFilters` antes de entrar al pool (hoy bypasea el pre-filtro y llena el pool de condenados).

## 5. Orden de variantes
- `buildQueryVariants`: con 1 keyword y género disponible → `["kw género", "kw"]`
  (la productiva antes que la doomed). Resto igual.

## 6. Frontend — etiqueta honesta del vocabulario
- `frontend/src/lib/reasons.ts` `intentSummary`: keywords →
  `términos de búsqueda: dark, claustrophobic, 3d` (sin diccionario: vocabulario abierto).

## 7. Tests
- intentService: reglas del prompt (clasificación).
- discovery: skip de condenados sin consumo de Brave/LLM; intent se propaga.
- candidates: cache filtrada por must; orden de variantes con 1 keyword.
- e2e: caso "oscuro asfixiante 3d" → resultados con horror 3D (mock con datos afines).

## 8. Verificación
Suite completa + smoke + lint + builds + prueba manual en docker del escenario del usuario.

---

# ROADMAP (ronda siguiente, aprobada como concepto): Léxico de keywords con embeddings

Diseño acordado con el usuario (su propuesta, refinada):
- **Diccionario canónico creciente**: término nuevo → si asimila (similitud ≥ umbral) a uno
  existente se mapea al canónico; si no, nueva entrada.
- **Semilla curada** 30-50 términos (los del prompt: zombies, pirates, soulslike, farming…)
  para no depender del orden de llegada.
- **Procedencia de alias** (canónico → aliases[] con origen) para auditar/revertir.
- **Literal primero**: match exacto/talo asimila gratis; solo no-literales gastan embedding.
- **3 puntos de integración**: intent del usuario, enrichment (keywords adicionales),
  siembra de discovery. El matcher NO cambia (sigue literal sobre vocabulario canónico).
- **Fallback** a matching literal si el servicio de embeddings no responde.
- **Almacenamiento**: tabla/JSON + cosine en memoria (sin pgvector en V1).
- **Backfill** de asimilación sobre keywords existentes del catálogo.
- Cuenta como competencia "Embeddings" del módulo IA (ESTADO_CURSO).

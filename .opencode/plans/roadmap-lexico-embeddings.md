# HOJA DE RUTA — Léxico de keywords con embeddings

Diccionario canónico minado → supervisado → migración de la BD → integración en caliente.
(Tras esta ronda: competencia "Embeddings" del módulo IA, ESTADO_CURSO.)

## Principio de diseño (acordado)

El matcher NO cambia: sigue comparando talos literales sobre un vocabulario
canónico y acotado. El diccionario es el puente entre el lenguaje abierto del
usuario y el vocabulario cerrado del catálogo:

- Término nuevo → si asimila (similitud ≥ umbral) a uno existente → alias suyo.
- Si es suficientemente distinto → entrada nueva del diccionario.
- Regla de oro: **rellena/normaliza, nunca degrada** — el matching sigue siendo
  explicable ("keyword: zombies ✓"), solo el dato previo se normaliza.

---

## FASE 0 — Decisiones técnicas (CERRADAS — revisadas con el usuario)

| Decisión | DECIDIDO |
|---|---|
| Modelo de embeddings | **OpenAI `text-embedding-3-small`** (1536 dims) |
| Almacenamiento | **Tabla Prisma `keyword_lexicon`** + cache en memoria |
| Presupuesto | Categoría `embedding` en BudgetLedger (env, p. ej. 2000/día) |
| Umbral de asimilación | Inicial ~0.82, calibrado en FASE 2 con golden set |
| Keywords no asimilables | **Se proponen como entradas nuevas** (informe, aprobación del usuario) |
| Secuenciación | **Fase a fase con supervisión**: FASE 1 → parada para revisión → resto |

## FASE 1 — Minado del diccionario (offline + supervisión del usuario)

1. **Minado** — script `npm run lexicon:mine` (se conserva como herramienta):
   - Agrega TODAS las keywords de las fichas del catálogo (PG) con frecuencias.
   - Candidatas = frecuencia ≥ N (configurable; con ~136 fichas, empezar en 4-5),
     ordenadas por frecuencia descendente.
   - **Asimilación greedy** (garantía de distinción por construcción): por cada
     candidata, literal/talo contra aceptadas → alias gratis; si no, embedding →
     similitud ≥ umbral → alias (con procedencia: término, canónico, score, fecha);
     si no → **nueva entrada canónica** (embedding calculado y guardado).
   - Fuentes complementarias: keywords sembradas por discovery y añadidas por
     enrichment (mismo pool de candidatas).
2. **Informe de supervisión** (markdown/JSON): diccionario propuesto + todas las
   asimilaciones (alias → canónico, score) + términos rechazados por frecuencia.
   El usuario revisa: renombrar canónicos, separar fusiones erróneas, rechazar ruido.
3. **Completado LLM supervisado**: pedir a gpt conceptos relevantes para usuarios
   ausentes del catálogo ("soulslike", "cozy"…), pasarlos por el mismo filtro
   greedy, añadirlos al informe para aprobación.
4. **Aceptación**: el diccionario aprobado se siembra en `keyword_lexicon`.

**Salida**: tabla poblada + informe revisado + script de minado (herramienta permanente).

### Alcance de implementación de la FASE 1 (primera sesión de build)

1. Migración Prisma: tabla `keyword_lexicon`
   (canonical unique, aliases Json, embedding Json, source, frequency, created_at).
2. `scripts/mineLexicon.ts` + `npm run lexicon:mine`:
   - Agrega keywords de PG con frecuencias (fichas actuales).
   - Filtros: `LEXICON_MIN_FREQUENCY` (default 4), longitud mínima.
   - Asimilación greedy en orden de frecuencia: literal/talo → alias gratis;
     resto → `text-embedding-3-small` → coseno ≥ `LEXICON_SIMILARITY_THRESHOLD`
     (default 0.82) → alias; si no → entrada nueva (embedding persistido en el draft).
   - **Salida**: `backend/reports/lexicon-draft.json` (diccionario propuesto:
     canónicos con aliases, embeddings, frecuencias, procedencia) +
     `lexicon-mine-report.md` (informe legible para supervisión: asimilaciones,
     nuevos conceptos, rechazados por frecuencia).
   - NO escribe aún en la tabla: primero supervisión del usuario.
3. `npm run lexicon:accept` (segundo paso, tras tu revisión del informe):
   importa el draft (posiblemente editado a mano) a la tabla `keyword_lexicon`.
4. Tests unit: algoritmo greedy con embedder falso (literal/stem/embedding/new),
   determinismo y procedencia.

**PARADA DE SUPERVISIÓN**: se presenta el informe y no se continúa a FASE 2/3
hasta tu aprobación del diccionario.

## FASE 2 — Umbral calibrado con golden set

- Golden set de pares: mismos-concepto (infectados/zombies, undead/zombies,
  cozy/cosy, roguelike/rogue-lite, metroidvania/metroid-vania) y distintos
  (zombies/cars, cozy/horror, pirate/racing).
- Test unitario del clasificador (asimila/rechaza) con el modelo elegido.
- Calibrar umbral empíricamente; dejar la decisión documentada en constants.

## FASE 3 — Pasada única de reinterpretación de la BD (script TEMPORAL)

1. Script `npm run lexicon:migrate` (SE BORRA al terminar, como acordamos):
   - Por ficha: keyword literal/talo → mapeo directo al canónico;
     no-literales → embedding → asimilar a canónico **o** proponer entrada nueva.
   - Reescribe `games.keywords` (vocabulario normalizado) — mergeKeywords conserva
     orden y dedup; NADA se descarta: lo no asimilable se propone, no se borra.
2. **Informe de la pasada**: por-ficha (antes → después), aliases creados,
   propuestas de conceptos nuevos → revisión del usuario → re-ejecución si toca ajustar.
3. Aprovechamiento (tu requisito): las keywords de la BDD alimentan el diccionario
   en esta misma pasada — el léxico sale más rico que el minado inicial.
4. Cierre: `seed:export` + `import-games` (cache coherente) + borrado del script.

## FASE 4 — Integración en caliente (por demanda)

1. `src/services/keywordLexiconService.ts`:
   - Carga el léxico + embeddings en memoria (lazy al primer uso).
   - `canonicalize(terms): Promise<Canonicalized[]>` con método por término
     (`literal | stem | embedding | new`), cache de embeddings de términos nuevos.
   - **Fallback**: si falla la llamada de embedding o el presupuesto está seco →
     literal/talo solamente (log, sin romper la búsqueda).
2. **Punto 1 — intent**: post-proceso determinista tras `resolveIntent`:
   canonicalizar `keywords` y `excluded.keywords` ("infectados"→"zombies") antes
   del matching. El LLM propone, el diccionario confirma.
3. **Punto 2 — enrichment**: `additionalKeywords` se canonicalizan antes de
   `mergeKeywords` → el catálogo converge al vocabulario canónico.
4. **Punto 3 — discovery**: `seedQueryKeywords` canonicaliza los términos sembrados.
5. Presupuesto: categoría `embedding` en el ledger; límite por env.

## FASE 5 — Tests, verificación y cierre

- Unit: servicio de léxico (los 4 métodos), asimilación greedy (embedder falso),
  fallback, presupuesto.
- Integration: tabla `keyword_lexicon` (migración Prisma + CRUD).
- E2E: búsqueda "juego de infectados" → matchea fichas etiquetadas "zombies".
- `ESTADO_CURSO.json`: marcar competencia **Embeddings** al cerrar.
- Política documentada en los headers de los scripts.

## Orden y tamaño estimado

| Fase | Qué | Tamaño |
|---|---|---|
| 0 | Decisiones (tabla de arriba) | conversación |
| 1 | Minado + informe + supervisión | 1 sesión |
| 2 | Golden set + umbral | corta |
| 3 | Migración BD + informe + borrado script | 1 sesión |
| 4 | Servicio + 3 puntos de integración + fallback | 1 sesión |
| 5 | Tests e2e + cierre + ESTADO_CURSO | corta |

## Riesgos y mitigaciones

- **Umbral mal calibrado** → fusiones erróneas permanentes → mitigado por
  procedencia de aliases + supervisión + re-ejecución del informe.
- **Dependencia del orden** → mitigada por semilla curada + greedy por frecuencia.
- **Gasto en embeddings** → presupuesto propio + literal-first (0 llamadas en la
  mayoría de casos) + cache de términos.
- **Catálogo crece con vocabulario nuevo** → el minado es re-ejecutable como
  herramienta; las entradas nuevas de la pasada en caliente se auditan en el informe.

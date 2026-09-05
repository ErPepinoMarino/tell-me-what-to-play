# Plan: fixes post-test (A-E) — diagnóstico verificado en BD/contenedor

## A. Matcher — contradicción total estrictamente negativa (causa del cozy/terror)
- `backend/src/matching/matchGame.ts` `computeSemanticRanking`:
  contribución amplificada = `(agreement - 1) / comparable` (antes: `-agreement/comparable`,
  que para distancia 1 daba -0 = 0 y EMPATABA con juegos sin datos; el desempate
  por cobertura favorecía a los bien conocidos — Bloodborne en "cozy").
  - Verificar: distancia 1 → -1 (mínimo); distancia 0.8 → -0.96; no amplificados igual.
- Actualizar fixtures/tests: S2 scoreRange → [-0.97,-0.95]; A1 ídem; invariants I2 sigue
  en [-1,1] (cada contribución ∈ [-1,1]). Añadir caso de regresión: contradicción TOTAL
  (distancia 1) puntúa estrictamente por debajo de un juego sin datos (caso cozy/Bloodborne).

## B. Frontend
- `RecommendationSection.applyResponse`: "more" REEMPLAZA (`setResults(response.results)`)
  — el backend entrega una tanda nueva; el acumulado era el bug percibido.
- `lib/notices.ts`: PARTIAL_RESULTS y SEARCH_EXHAUSTED → INTERNAL_NOTICES (solo demo).
- Mensaje informativo nuevo para anónimos cuando la respuesta es parcial/vacía:
  "Puedes refinar la búsqueda con más detalles y guardar una lista personalizada de
  juegos si inicias sesión." — condicionado a `!authenticated` (render en
  RecommendationSection con meta.partial/results.length === 0).

## C. Léxico — fusión supervisada + lexicon:apply permanente
1. BD: `UPDATE keyword_lexicon SET aliases = array_append(aliases,'infected') WHERE canonical='zombies'`.
2. Recrear el script de migración como HERRAMIENTA PERMANENTE (lección de esta ronda:
   cualquier cambio del diccionario exige re-aplicar el vocabulario al catálogo):
   `scripts/applyLexiconKeywords.ts` + `npm run lexicon:apply` (el contenido del antiguo
   migrateKeywords: literal/alias/talo/compuesto"/"/embedding 0.70 + propuestas).
3. Ejecutar `lexicon:apply --apply` → los juegos "Infected*" pasan a keyword "zombies".
4. seed:export + import-games si algún seed resultara afectado (no debería).

## D. Prompt del intérprete (`intentService.ts`)
Regla nueva con el ejemplo real que falló:
- "something similar to X" / "parecido a X" → gameReferenced DEBE incluir X.
- "pero que no sea X" → además excluded.keywords con X (sigla + nombre completo).
- Ejemplo: "algo similar a god of war pero que no sea god of war" →
  gameReferenced ["God of War"], excluded.keywords ["god of war"].
- Nunca dropear la referencia al convertir el resto en géneros/semánticas.

## E. Variantes para intents solo-plataforma/año
- Documentar la limitación y hacer explícito el early-stop en `buildQueryVariants`
  (platforms/año sin keywords/géneros → [] → no-query inmediato, sin llamada IGDB):
  el text-search de IGDB no puede servir estos intents; el fix real es la ronda
  siguiente (consultas filtradas de IGDB con IDs — aprobada como siguiente ronda).
- Test en queryVariants.test documentando el contrato actual.

## F. Verificación
1. Tests unit (matcher + queryVariants) actualizados en verde.
2. Suite completa (471+), lint, builds backend/frontend.
3. Usuario: rebuild docker + re-test de la batería (cozy/more, infectados→zombies,
   ps2 2004, god of war similar).

## Fuera de alcance (siguiente ronda, aprobada)
- IGDB filtrado: consultas `where genres/keywords/release_year/platforms` con mapeo de
  IDs (diseño propio: cliente, mapeos, fakes, tests) — arregla 3b estructuralmente.

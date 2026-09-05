# Plan: refinamiento conversacional + diccionario por demanda + trazabilidad

Decisiones: descriptores = keywords (léxico con embeddings, ya acordado; falta
persistir entradas nuevas). Brave con crédito (re-lanzar backfill). Trazabilidad
del 402 (log + aviso). Ejecutar.

## A. Prompt refine — regla dura de carry-forward (`intentService.ts`)
- "Carry forward EVERY field of the previous intent — keywords, genres,
  platforms, gameModes, perspectives, releaseYear/yearFrom/yearTo, excluded,
  AND ALL semantic values — unless the message explicitly changes or removes
  it. Never silently drop a year range or a semantic value."
- (El caso observado: "posterior al 2000" se perdió en la extracción inicial y
  por tanto nada que arrastrar; la regla lo fija para años existentes.)

## B. Prompt años — casos en español (`intentService.ts`)
- "posteriores al año 2000" → yearFrom: 2001; "anteriores a 2010" → yearTo: 2009;
  "desde 2004" → releaseYear 2004. (Hoy solo hay ejemplos en inglés "after/before".)

## C. Prompt pace — dirección explícita
- "slow/paced/ritmo lento → pace near 0 (cercano a 0); fast/frantic/ritmo
  rápido → pace near 1." (El caso "ritmo lento" → pace 0.5 era neutro.)

## D. Trazabilidad del enrichment (402 y errores) (`discovery.ts`)
- En el catch de enrich (discoverByQuery, discoverByName, reEnrich): trace
  `enrichment-error` { slug, error: String(error) } — el log muestra Brave/LLM.
- Si en una petición hubo fallos de enrich y no se creó nada → notice
  DISCOVERY_UNAVAILABLE (visible en demo) — honestidad UX.

## E. Diccionario que crece por demanda (`keywordLexiconService.ts` + wiring)
- `canonicalizeIntent`: las keywords del USUARIO que quedan UNMAPPED (con vector
  calculado) se PERSISTEN como entrada nueva en keyword_lexicon
  (source "hot", embedding del batch, aliases []), salvo stopwords/ruido-tech/
  fragmentos. Upsert idempotente por canonical.
- Solo vía intents (demanda real), no en enrichment/seeding (evita ruido).
- Nuevo dep `growDictionary?: (term, embedding) => Promise<void>` inyectado con
  prisma en orchestrator/index.ts.

## F. Backfill completo (Brave con crédito)
- `npm run enrich:backfill` → las fichas restantes (< 7 semánticas) se
  enriquecen en una pasada. Luego informe: cuántas con semánticas, cuántas null.

## G. Tests
- intentService: año en español, carry-forward de yearFrom en refine, pace.
- orquestador: refine conserva yearFrom/plataformas/semánticas de sesión.
- lexicon: canonicalizeIntent persiste concepto nuevo en la tabla (fake persist).

## Verificación
1. tsc + smoke + lint + builds.
2. Backfill + informe.
3. Usuario: rebuild docker + re-test del flujo conversacional (acumulación de
   chips: año/género/keywords/semánticas visibles en "He entendido").
# Plan: refine anon → CTA de login + guardia de año + trace completo

Diagnóstico verificado: anon no tiene sesión → previousIntent undefined → extracción
fresca (por diseño). El año SÍ se captura/arrastra en logueado (los chips lo prueban);
mi "año perdido" anterior era un artefacto del trace incompleto.

## 1. Trace completo (`recommendationOrchestrator.ts`)
- trace("intent") añade: `releaseYear, yearFrom, yearTo, excluded`.

## 2. Guardia determinista de años (red de seguridad)
- Helper puro `inferYearFromMessage(message)` (regex ES/EN):
  - "posteriores al (año )?(\d{4})" / "after (\d{4})" → yearFrom = N+1
  - "anteriores a (el año )?(\d{4})" / "before (\d{4})" → yearTo = N-1
  - "del año (\d{4})" / "desde (\d{4})" / "from (\d{4})" → releaseYear = N
  - "de los (90|80|70)s" → yearFrom/yearTo de la década
- Aplicado en el orquestador tras la extracción, solo si el campo está null
  (nunca pisa lo que la LLM capturó).
- Tests unit de la función.

## 3. Anon refine → CTA de login (LLM relation + contextIntent)
- **Schema**: `GameSearchIntent.relation: "new" | "refine" | null` (backend zod +
  espejo frontend). En refineInstructions: "Set relation: 'refine' when the
  message continues or adjusts the previous intent; 'new' when it starts a
  different topic."
- **API**: body `POST /api/recommendations` + opcional `contextIntent`
  (la última intención del cliente; para anon solo clasifica). JSON schema:
  object/null.
- **Orquestador** (resolveIntent, search):
  - anon: `previousIntent = request.contextIntent ?? undefined` (solo clasificar).
  - logged: `session.currentIntent` (como hoy; contextIntent ignorado).
  - Tras la extracción: si `actor === "anon" && intent.relation === "refine"` →
    respuesta inmediata vacía con notice nuevo `REFINE_REQUIRES_LOGIN` (antes de
    isEmptyIntent).
- **Frontend**:
  - `RecommendationSection.send`: envía `contextIntent: intent` (el último).
  - `notices.ts`: `REFINE_REQUIRES_LOGIN` → "Para refinar la búsqueda tienes que
    iniciar sesión con tu cuenta de Google. Si lo haces podrás, además, crear una
    lista personalizada de juegos. Si no puedes seguir usando la búsqueda normal."
  - `types/Recommendation.ts`: mirror (relation + contextIntent).
- **Tests**: orquestador (anon+context refine → REFINE_REQUIRES_LOGIN; anon new →
  búsqueda fresca; logged sin cambios), intentService (regla relation en prompt),
  e2e mock con relation null.

## Verificación
1. tsc + smoke + lint + builds.
2. Usuario: rebuild docker + re-test: anon "busco cozy... > uno similar pero de
   jardineria?" → CTA de login; logueado → merge con año/géneros/semánticas
   visibles en los chips; trace del intent con yearFrom/excluded.
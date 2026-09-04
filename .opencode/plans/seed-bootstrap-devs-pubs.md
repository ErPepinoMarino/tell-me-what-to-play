# Plan: developers/publishers + bootstrap del catálogo seed al arrancar

Aprobado por el usuario (ambas decisiones). Combinado con lo ya pactado esta ronda.

## 1. Fix developers/publishers (reEnrich)
- `backend/src/orchestrator/discovery.ts` — `reEnrich`: regla "rellena lo que falta, nunca degrada":
  `developers: game.developers.length > 0 ? game.developers : candidate.developers`
  `publishers: game.publishers.length > 0 ? game.publishers : candidate.publishers`
- Causa raíz (ya diagnosticada): la adopción de objetivos del reEnrich no incluía
  developers/publishers → las 18 fichas del seed rehabilitadas quedaron con arrays vacíos.

## 2. Backfill con criterio ampliado
- `backend/scripts/enrichBackfill.ts`: targets = fichas con
  `sourceId === null || knownSemantics < umbral || (developers vacío && publishers vacío)`.
- Ejecutar `npm run enrich:backfill` (budget guard activo), luego `npm run seed:export`
  y `npm run import-games` (frontend) para refrescar games_seed.json y games.ts.

## 3. Bootstrap del catálogo al arrancar (decisión: arranque del server)
- Nuevo `backend/src/services/seedCatalogService.ts`:
  `ensureSeedCatalog(catalog: CatalogLayer): Promise<{ created: number; skipped: number }>`
  - Fuente de datos: `src/data/games.ts` (va empaquetado en el build; el JSON queda
    como fixture versionado y `import-games` es el puente).
  - Idempotente: upsert por slug, SKIP de existentes (nunca sobreescribe fichas
    enriquecidas de PG con datos del seed).
- `backend/src/server.ts`: antes de `listen`, `await ensureSeedCatalog(prismaCatalogLayer)`
  en try/catch con log (best-effort: si PG cae, el server arranca igual).
- `backend/scripts/seedCatalog.ts`: reescrito para reutilizar la función compartida
  (conserva `./env.js` para CLI desde el host).
- Tests unit con FakeCatalogLayer: crea solo faltantes, skip existentes, no sobreescribe.

## 4. Tests
- `tests/services/discovery.test.ts`: reEnrich sin sourceId verifica adopción de
  developers/publishers (raw con involved_companies); nuevo caso "nunca degrada"
  (ficha con devs conocidas los conserva).
- Nuevo test del seedCatalogService.

## 5. Verificación
1. Suite completa + smoke + lint + builds (backend y frontend).
2. Query BD: los 20 del seed con developers/publishers (FromSoftware, CD Projekt, Larian…).
3. Arranque del server: log del bootstrap (created/skipped).

## Política (documentada en los headers de los scripts)
- Población: automática al arrancar el backend (idempotente) + CLI manual.
- Eliminación: ninguna en V1 (cap maxCatalogSize=350k con notice CATALOG_FULL).
- El seed JSON solo cambia manualmente (seed:export tras backfills).

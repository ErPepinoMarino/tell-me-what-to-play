# Plan: fix bordes 0.5 + refinamiento riguroso de los dos juegos sospechosos

## 0. VERIFICACIÓN (rigor, antes de tocar nada)
- Volcar las 13 semánticas de `2d-brick-breaker-game-remastered-2022` y
  `flee-my-elven-ninja-3d-2026`: si muchas dimensiones valen EXACTAMENTE 0.5,
  queda confirmado el "0.5 por defecto" del LLM (no solo coziness).

## A. Bordes consistentes (`backend/src/matching/matchGame.ts`)
- Amplificación de contradicción: `distancia > AMPLIFICATION_THRESHOLD` (estricta).
  - Antes: intent 1 + juego 0.5 → distancia 0.5 → "contradice" (chip ✗) AUNQUE
    el gate de presencia lo aprobaba (≥ 0.5). Ahora: 0.5 NO amplifica →
    coherencia gate/ranking/chip.
  - Verificado: ningún escenario calibrado (S1/S2/S4, golden) tiene distancia
    exactamente 0.5.

## B. Enrichment prompt (`backend/src/services/enrichmentService.ts`)
- Regla nueva: "NEVER output exactly 0.5 as a neutral/unsure default. 0.5 means
  the evidence GENUINELY supports a moderate degree; when the evidence is
  insufficient, use null."

## C. Refinamiento riguroso de los dos juegos
1. `UPDATE games SET <13 dims> = NULL WHERE slug IN ('2d-brick-breaker-game-remastered-2022','flee-my-elven-ninja-3d-2026')`.
2. Re-enrich con el prompt corregido: `npm run enrich:backfill -- --slug=<cada uno>`
   (tienen source_id y quedarán con 0 semánticas → seleccionados).
3. Verificar sus nuevos valores: basados en evidencia o null — SIN 0.5 por defecto.

## D. Otros fixes ya en el código de esta ronda (sin cambios)
- Gate de presencia (0.9/0.5, null fuera) — ya implementado y testeado.
- "More" reemplaza; notices internos; mensaje anónimo; chips de intención;
  explicación sin pipeline — ya implementados.

## E. Verificación
1. tsc + smoke + lint + builds (backend/frontend).
2. Suite completa (con docker parado si interfiere) — salvo auth (interferencia conocida).
3. Usuario: rebuild docker + re-test (cozy + "dame más": SIN chip "contradice";
   los 0.5-default re-enriquecidos).

## Pendiente (decisión futura del usuario)
- La polución global de 0.5 (67 pace, 13 darkness, 9 horror): el mismo
  tratamiento (null + re-enrich) es aplicable por lotes cuando se decida;
  no aprobado en esta ronda.

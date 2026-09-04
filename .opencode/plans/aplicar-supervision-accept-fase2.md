# Plan: aplicar supervisión del draft + aceptar + FASE 2

Aprobado por el usuario ("Aplicar y aceptar" + decisiones registradas).

## Ediciones al draft (`backend/reports/lexicon-draft.json`)

Script temporal `scripts/applySupervisionEdits.ts` (SE BORRA tras ejecutar):

1. **División de compuestos IGDB** (frecuencia heredada, sin embedding —
   `lexicon:accept` los calculará):
   - `bird view / isometric` (freq 23) → `bird view` + `isometric`
   - `hack and slash/beat 'em up` (freq 16) → `hack and slash` + `beat 'em up`
2. **Curados del usuario** (source "curated", freq 0, sin embedding):
   `3d platformer, assassin, auto-saving, base management, business, cat,
   choices matter, cinematic, city building, civilization building, colorful,
   cooperative, cyberpunk, dragons, dwarves`
   (15 términos — `character creation` descartada por el usuario:
   quasi-duplicado de `character customization`, que tiene frecuencia real 6).

## Exclusión de plataformas en el minado (`scripts/mineLexicon.ts`)

Ampliar TECH_NOISE con plataformas para que nunca se propongan en FASE 3:
`super nintendo entertainment system` + consolas/plataformas típicas
(playstation*, xbox*, nintendo*, wii*, sega*, pc, mac, linux, switch, game boy*, psp, ps*, snes, nes, n64…).
(Protege la "puerta trasera" detectada: keywords no mapeadas se proponen como nuevas en FASE 3.)

## Ejecución

1. Crear y ejecutar el script temporal de ediciones del draft.
2. `npm run lexicon:accept` → importa el draft (232 entradas esperadas:
   215 − 2 compuestos + 4 divisiones + 15 curados) a la tabla `keyword_lexicon`
   (calcula los 17 embeddings que faltan).
3. Borrar el script temporal.

## FASE 2 — Golden set + calibración del umbral

1. `scripts/calibrateLexicon.ts` + `npm run lexicon:calibrate`:
   embeds los pares dorados con el modelo real y imprime la tabla de
   similitudes con PASS/FAIL contra el umbral 0.82.
   - Mismo concepto: infectados/zombies, undead/zombies, cozy/cosy,
     roguelike/rogue-lite, metroidvania/metroid-vania, open world/open-world,
     hack and slash/hack-and-slash, awarded/nominee (debe FALLAR: winner ≠ nominee).
   - Distinto concepto: zombies/cars, cozy/horror, pirate/racing, dragons/business.
2. Ajustar el umbral si algún par sale del lado equivocado; documentar la
   decisión en el servicio (`keywordLexiconService.ts` / constants).
3. Test unitario con las similitudes registradas (sin red) fijando el contrato.
4. Verificación: tsc, smoke, lint, build. Parada de revisión con el usuario
   antes de FASE 3 (migración de la BD).

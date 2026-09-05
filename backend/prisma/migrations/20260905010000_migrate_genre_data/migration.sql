-- Data migration de géneros obsoletos. Los valores ACTION/CASUAL/MMO no
-- existen en la taxonomía de IGDB: no pueden importarse juegos con ellos.
-- ACTION -> familia de acción real de IGDB (Shooter/Fighting/Hack&slash/Arcade)
UPDATE "games" SET genres = array_cat(
  array_remove(genres, 'ACTION'),
  ARRAY['SHOOTER', 'FIGHTING', 'HACK_AND_SLASH_BEAT_EM_UP', 'ARCADE']::"Genre"[]
) WHERE 'ACTION' = ANY(genres);

-- CASUAL -> keyword (IGDB no lo clasifica en ninguna taxonomía)
UPDATE "games" SET keywords = array_append(keywords, 'casual') WHERE 'CASUAL' = ANY(genres);
UPDATE "games" SET genres = array_remove(genres, 'CASUAL');

-- MMO -> game_mode MASSIVELY_MULTIPLAYER (game_modes id 5 de IGDB)
UPDATE "games" SET game_modes = array_append(game_modes, 'MASSIVELY_MULTIPLAYER') WHERE 'MMO' = ANY(genres);
UPDATE "games" SET genres = array_remove(genres, 'MMO');

-- PostgreSQL no soporta ALTER TYPE ... REMOVE VALUE: borrado directo de
-- pg_enum (requiere superuser, que es el caso en compose). El nombre del
-- tipo en la tabla pg_type es "Genre".
DELETE FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Genre')
  AND enumlabel IN ('ACTION', 'CASUAL', 'MMO');
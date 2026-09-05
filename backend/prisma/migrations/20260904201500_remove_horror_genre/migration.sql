-- El género HORROR era un artefacto del seed manual: IGDB expresa el terror
-- como THEME (que acaba en keywords del catálogo), no como género.
-- Data-migration: las fichas etiquetadas HORROR pasan a keyword "horror".
UPDATE "games" SET keywords = array_append(keywords, 'horror') WHERE 'HORROR' = ANY(genres);
UPDATE "games" SET genres = array_remove(genres, 'HORROR');

-- PostgreSQL no soporta ALTER TYPE ... REMOVE VALUE: la vía estándar es el
-- borrado directo de pg_enum (requiere superuser, que es el caso en compose).
DELETE FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Genre')
  AND enumlabel = 'HORROR';

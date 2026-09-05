-- Géneros alineados 1:1 con la taxonomía pública de IGDB (/v4/genres).
-- Renombres 1:1 (el valor renombrado se propaga a las columnas existentes).
ALTER TYPE "Genre" RENAME VALUE 'PLATFORMER' TO 'PLATFORM';
ALTER TYPE "Genre" RENAME VALUE 'SIMULATION' TO 'SIMULATOR';
ALTER TYPE "Genre" RENAME VALUE 'SPORTS' TO 'SPORT';
ALTER TYPE "Genre" RENAME VALUE 'RPG' TO 'ROLE_PLAYING_RPG';

-- Géneros nuevos que faltaban de IGDB.
ALTER TYPE "Genre" ADD VALUE 'POINT_AND_CLICK';
ALTER TYPE "Genre" ADD VALUE 'REAL_TIME_STRATEGY';
ALTER TYPE "Genre" ADD VALUE 'TURN_BASED_STRATEGY';
ALTER TYPE "Genre" ADD VALUE 'TACTICAL';
ALTER TYPE "Genre" ADD VALUE 'HACK_AND_SLASH_BEAT_EM_UP';
ALTER TYPE "Genre" ADD VALUE 'QUIZ_TRIVIA';
ALTER TYPE "Genre" ADD VALUE 'PINBALL';
ALTER TYPE "Genre" ADD VALUE 'CARD_AND_BOARD_GAME';
ALTER TYPE "Genre" ADD VALUE 'MOBA';
ALTER TYPE "Genre" ADD VALUE 'MUSIC';

-- GameMode: MMO es un game_mode real de IGDB (id 5), no un género.
ALTER TYPE "GameMode" ADD VALUE 'MASSIVELY_MULTIPLAYER';

-- Themes: nueva taxonomía (22 de IGDB + UNKNOWN).
CREATE TYPE "Theme" AS ENUM (
  'ACTION', 'BUSINESS', 'COMEDY', 'DRAMA', 'EDUCATIONAL', 'EROTIC',
  'FANTASY', 'FOUR_X', 'HISTORICAL', 'HORROR', 'KIDS', 'MYSTERY',
  'NON_FICTION', 'OPEN_WORLD', 'PARTY', 'ROMANCE', 'SANDBOX',
  'SCIENCE_FICTION', 'STEALTH', 'SURVIVAL', 'THRILLER', 'WARFARE',
  'UNKNOWN'
);

ALTER TABLE "games" ADD COLUMN "themes" "Theme"[] NOT NULL DEFAULT ARRAY['UNKNOWN']::"Theme"[];

-- Léxico: referencia IGDB para el diccionario completo (7.409 keywords).
ALTER TABLE "keyword_lexicon" ADD COLUMN "igdb_slug" TEXT;
ALTER TABLE "keyword_lexicon" ADD COLUMN "igdb_id" INTEGER;
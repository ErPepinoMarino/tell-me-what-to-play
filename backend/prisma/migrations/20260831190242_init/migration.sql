-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "game_status" AS ENUM ('PENDING', 'PLAYED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "recommendation" AS ENUM ('HIGHLY_RECOMMENDED', 'RECOMMENDED', 'MEH', 'NOT_RECOMMENDED');

-- CreateEnum
CREATE TYPE "Genre" AS ENUM ('ACTION', 'ADVENTURE', 'ARCADE', 'CASUAL', 'FIGHTING', 'HORROR', 'INDIE', 'MMO', 'PLATFORMER', 'PUZZLE', 'RACING', 'RPG', 'SHOOTER', 'SIMULATION', 'SPORTS', 'STRATEGY', 'VISUAL_NOVEL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('PC', 'MAC', 'LINUX', 'PS5', 'PS4', 'PS3', 'PS2', 'PS1', 'PS_VITA', 'PSP', 'XBOX_SERIES', 'XBOX_ONE', 'XBOX_360', 'XBOX', 'SWITCH', 'WII_U', 'WII', 'GAMECUBE', 'N64', 'SNES', 'NES', 'NINTENDO_3DS', 'DS', 'GAME_BOY', 'GAME_BOY_ADVANCE', 'IOS', 'ANDROID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('SINGLE_PLAYER', 'MULTIPLAYER', 'COOPERATIVE', 'COMPETITIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Perspective" AS ENUM ('FIRST_PERSON', 'THIRD_PERSON', 'TOP_DOWN', 'ISOMETRIC', 'SIDE_VIEW', 'TEXT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "games" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "description_es" TEXT,
    "description_en" TEXT,
    "cover_url" TEXT,
    "release_year" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "complexity" DOUBLE PRECISION,
    "coziness" DOUBLE PRECISION,
    "darkness" DOUBLE PRECISION,
    "developers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" DOUBLE PRECISION,
    "exploration" DOUBLE PRECISION,
    "game_modes" "GameMode"[] DEFAULT ARRAY['UNKNOWN']::"GameMode"[],
    "horror" DOUBLE PRECISION,
    "humor" DOUBLE PRECISION,
    "isolation" DOUBLE PRECISION,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "narrative" DOUBLE PRECISION,
    "pace" DOUBLE PRECISION,
    "perspectives" "Perspective"[] DEFAULT ARRAY['UNKNOWN']::"Perspective"[],
    "publishers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_count" INTEGER NOT NULL DEFAULT 0,
    "strategy" DOUBLE PRECISION,
    "tension" DOUBLE PRECISION,
    "violence" DOUBLE PRECISION,
    "genres" "Genre"[] DEFAULT ARRAY['UNKNOWN']::"Genre"[],
    "platforms" "Platform"[] DEFAULT ARRAY['UNKNOWN']::"Platform"[],

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_games" (
    "user_id" INTEGER NOT NULL,
    "game_id" INTEGER NOT NULL,
    "status" "game_status",
    "recommendation" "recommendation",
    "review" TEXT,

    CONSTRAINT "user_games_pkey" PRIMARY KEY ("user_id","game_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL DEFAULT 'USER',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "Role" NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_sub" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "games_source_id_key" ON "games"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_sub_key" ON "user_identities"("provider", "provider_sub");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_user_id_key" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

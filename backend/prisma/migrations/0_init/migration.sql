-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "game_status" AS ENUM ('PENDING', 'PLAYED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "recommendation" AS ENUM ('HIGHLY_RECOMMENDED', 'RECOMMENDED', 'MEH', 'NOT_RECOMMENDED');

-- CreateTable
CREATE TABLE "games" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "release_year" INTEGER,
    "genres" TEXT[],
    "platforms" TEXT[],
    "rating" DECIMAL,

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

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;



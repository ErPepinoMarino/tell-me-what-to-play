import { prisma } from "../lib/prisma.js";
import type { Game } from "../types/Game.js";
import type { IGameRepository } from "./IGameRepository.js";

export const prismaGameRepository: IGameRepository = {
  async getAll(): Promise<Game[]> {
    const games = await prisma.games.findMany();

    return games.map((game) => ({
      id: game.id,
      slug: game.slug,
      title: game.title,
      description: game.description ?? "",
      coverUrl: game.cover_url ?? "",
      releaseYear: game.release_year ?? 0,
      genres: game.genres,
      platforms: game.platforms,
      rating: game.rating ? Number(game.rating) : 0,
    }));
  },

  async getBySlug(slug: string): Promise<Game | undefined> {
    const game = await prisma.games.findUnique({
      where: { slug },
    });

    if (!game) return undefined;

    return {
      id: game.id,
      slug: game.slug,
      title: game.title,
      description: game.description ?? "",
      coverUrl: game.cover_url ?? "",
      releaseYear: game.release_year ?? 0,
      genres: game.genres,
      platforms: game.platforms,
      rating: game.rating ? Number(game.rating) : 0,
    };
  },

  async search(query: string): Promise<Game[]> {
    const games = await prisma.games.findMany({
      where: {
        title: {
          contains: query,
          mode: "insensitive",
        },
      },
    });

    return games.map((game) => ({
      id: game.id,
      slug: game.slug,
      title: game.title,
      description: game.description ?? "",
      coverUrl: game.cover_url ?? "",
      releaseYear: game.release_year ?? 0,
      genres: game.genres,
      platforms: game.platforms,
      rating: game.rating ? Number(game.rating) : 0,
    }));
  },
  async create(game: Game): Promise<Game> {
    const createdGame = await prisma.games.create({
      data: {
        slug: game.slug,
        title: game.title,
        description: game.description,
        cover_url: game.coverUrl,
        release_year: game.releaseYear,
        genres: game.genres,
        platforms: game.platforms,
        rating: game.rating,
      },
    });

    return {
      id: createdGame.id,
      slug: createdGame.slug,
      title: createdGame.title,
      description: createdGame.description ?? "",
      coverUrl: createdGame.cover_url ?? "",
      releaseYear: createdGame.release_year ?? 0,
      genres: createdGame.genres,
      platforms: createdGame.platforms,
      rating: createdGame.rating ? Number(createdGame.rating) : 0,
    };
  },
  async update(game: Game): Promise<Game> {
    const updatedGame = await prisma.games.update({
      where: {
        id: game.id,
      },
      data: {
        slug: game.slug,
        title: game.title,
        description: game.description,
        cover_url: game.coverUrl,
        release_year: game.releaseYear,
        genres: game.genres,
        platforms: game.platforms,
        rating: game.rating,
      },
    });

    return {
      id: updatedGame.id,
      slug: updatedGame.slug,
      title: updatedGame.title,
      description: updatedGame.description ?? "",
      coverUrl: updatedGame.cover_url ?? "",
      releaseYear: updatedGame.release_year ?? 0,
      genres: updatedGame.genres,
      platforms: updatedGame.platforms,
      rating: updatedGame.rating ? Number(updatedGame.rating) : 0,
    };
  },
  async delete(id: number): Promise<void> {
    await prisma.games.delete({
      where: { id },
    });
  },
};

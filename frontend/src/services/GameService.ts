import type { Game } from "../types/Game";

export async function searchGames(text: string): Promise<Game[]> {
  if (text === "error") {
    throw new Error("Error simulado");
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: 1, title: `${text} I`, year: 2001, rating: 90 },
        { id: 2, title: `${text} II`, year: 2005, rating: 92 },
        { id: 3, title: `${text} III`, year: 2010, rating: 95 },
      ]);
    }, 2000);
  });
}

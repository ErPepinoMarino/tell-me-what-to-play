export interface Game {
  id: number;
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
  releaseYear: number;
  genres: string[];
  platforms: string[];
  rating: number;
}

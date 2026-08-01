import type { Game } from "@/types/Game";
import GameCard from "./GameCard/GameCard";

type SearchResultsProps = {
  games: Game[];
  query?: string;
  selectedSlug?: string;
};

export default function SearchResults({
  games,
  query,
  selectedSlug,
}: SearchResultsProps) {
  if (!query) {
    return null;
  }
  if (games.length === 0) {
    return (
      <section>
        <h2>Search Results</h2>
        <p>No games found.</p>
      </section>
    );
  }
  return (
    <section>
      <h2>SearchResults</h2>
      {games.map((game) => (
        <GameCard
          key={game.slug}
          title={game.title}
          coverUrl={game.coverUrl}
          releaseYear={game.releaseYear}
          genres={game.genres}
          slug={game.slug}
          query={query}
          selected={selectedSlug === game.slug}
        />
      ))}
    </section>
  );
}

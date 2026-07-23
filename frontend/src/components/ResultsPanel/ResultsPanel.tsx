import GameCard from "../GameCard/GameCard";
import type { Game } from "../../types/Game";
import type { SearchStatus } from "../../types/SeachStatus";

function ResultsPanel({
  games,
  searchStatus,
}: {
  games: Game[];
  searchStatus: SearchStatus;
}) {
  if (searchStatus === "idle") {
    return <section>Escribe algo para buscar.</section>;
  }

  if (searchStatus === "loading") {
    return <section>Buscando...</section>;
  }

  if (searchStatus === "success") {
    return (
      <section>
        {games.length === 0
          ? "No hay resultados"
          : games.map((game) => <GameCard key={game.id} game={game} />)}
      </section>
    );
  }
  if (searchStatus === "error") {
    return (
      <section>Error crítico, formatee su disco duro inmediatamente.</section>
    );
  }
}

export default ResultsPanel;

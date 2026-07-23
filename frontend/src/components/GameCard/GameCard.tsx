import type { Game } from "../../types/Game";

function GameCard({ game }: { game: Game }) {
  return (
    <div>
      <br />
      Titulaso: {game.title}
      <br />
      Año: {game.year}
      <br />
      Puntuasion: {game.rating}
      <br />
      <br />
    </div>
  );
}

export default GameCard;

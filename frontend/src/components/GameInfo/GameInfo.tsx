import { Game } from "@/types/Game";
import Image from "next/image";

type GameInfoProps = {
  game?: Game;
};
//importante crerar el type GameInfoProps para podamos recibir o un game o undefined,
export default function GameInfo({ game }: GameInfoProps) {
  if (!game) {
    //si no hay un juego seleccionado, no renderizamos nada
    return null;
  } else {
    return (
      <section>
        <h2>GameInfo</h2>
        <div>
          <Image
            src={game.coverUrl}
            width={200}
            height={300}
            alt={game.title}
          />
          <h3>{game.title}</h3>
          <p>Year: {game.releaseYear}</p>
          <p>Genres: {game.genres.join(", ")}</p>
          <p>Description: {game.description}</p>
          {game.genres.map((genre) => (
            <p key={genre}>{genre}</p>
          ))}
          {game.platforms.map((platform) => (
            <p key={platform}>{platform}</p>
          ))}
          <p>Rating: {game.rating}</p>
        </div>
      </section>
    );
  }
}

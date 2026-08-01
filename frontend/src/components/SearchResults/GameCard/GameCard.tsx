import Image from "next/image";
import Link from "next/link";

type GameCardProps = {
  title: string;
  coverUrl: string;
  releaseYear: number;
  genres: string[];
  slug: string;
  query?: string;
  selected: boolean;
};

export default function GameCard({
  title,
  coverUrl,
  releaseYear,
  genres,
  slug,
  query,
  selected,
}: GameCardProps) {
  // Si el juego esta seleccionado, al volver a pulsar se elimina el game:slug de la url para que se cierre la ficha.
  // De lo contrario, se añade el game:slug a la url para que se abra la ficha. Fasilito.
  const href = selected
    ? {
        pathname: "/",
        query: query ? { q: query } : {},
      }
    : {
        pathname: "/",
        query: query ? { q: query, game: slug } : { game: slug },
      };

  return (
    <Link href={href}>
      <section>
        <div>
          <h3>{title}</h3>
          <Image src={coverUrl} width={150} height={225} alt={title} />
          <p>Year: {releaseYear}</p>
          <p>Genres: {genres.join(", ")}</p>
        </div>
      </section>
    </Link>
  );
}

import Header from "@/components/Header/Header";
import RecommendationSection from "@/components/Recommendation/RecommendationSection";
import SearchResults from "@/components/SearchResults/SearchResults";
import GameInfo from "@/components/GameInfo/GameInfo";
import MyLibrary from "@/components/MyLibrary/MyLibrary";
import Footer from "@/components/Footer/Footer";
import type { Game } from "@/types/Game";

//Más limpio sacar las props de la declaración de la función home, sino queda una guarrada verbosa.
type HomeProps = {
  searchParams: Promise<{
    q?: string;
    game?: string;
  }>;
};

//Esto básicamente es para que no se llame al backend en la build.
//Ya que frontend y backend son apps separadas y el backend no estará disponible en la build.
//Basta solo con declarar la variable para que Next.js lo entienda.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  //ves.
  const { q, game } = await searchParams;

  const apiUrl = process.env.API_URL ?? "http://localhost:3001";

  async function fetchGames(path: string): Promise<Game[]> {
    try {
      const res = await fetch(`${apiUrl}${path}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function fetchGame(path: string): Promise<Game | undefined> {
    try {
      const res = await fetch(`${apiUrl}${path}`);
      if (!res.ok) return undefined;
      return (await res.json()) as Game;
    } catch {
      return undefined;
    }
  }

  // Búsqueda de catálogo por deep-link (?q=): sigue funcionando para URLs
  // compartidas e indexación. La interacción principal es el flujo de
  // recomendación (RecommendationSection), que es conversacional.
  const games: Game[] = q
    ? await fetchGames(`/api/games?q=${encodeURIComponent(q)}`)
    : [];

  const selectedGame: Game | undefined = game
    ? await fetchGame(`/api/games/${encodeURIComponent(game)}`)
    : undefined;

  return (
    <main>
      <div>
        <Header />
        <RecommendationSection />
        {q ? <SearchResults games={games} query={q} /> : null}
        <GameInfo game={selectedGame} />
        <MyLibrary />
        <Footer />
      </div>
    </main>
  );
}

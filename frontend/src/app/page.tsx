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

  const apiUrl = process.env.API_URL;

  // Búsqueda de catálogo por deep-link (?q=): sigue funcionando para URLs
  // compartidas e indexación. La interacción principal es el flujo de
  // recomendación (RecommendationSection), que es conversacional.
  const games: Game[] = q
    ? await fetch(`${apiUrl}/api/games?q=${encodeURIComponent(q)}`).then(
        (res) => res.json()
      )
    : [];

  const selectedGame: Game | undefined = game
    ? await fetch(`${apiUrl}/api/games/${encodeURIComponent(game)}`).then(
        (res) => res.json()
      )
    : undefined;

  return (
    <main className="min-h-screen bg-gray-100 py-8">
      <div className="mx-auto max-w-4xl px-6">
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

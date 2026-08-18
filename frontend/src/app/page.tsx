import Header from "@/components/Header/Header";
import AIChat from "@/components/AIChat/AIChat";
import SearchBar from "@/components/SearchBar/SearchBar";
import SearchResults from "@/components/SearchResults/SearchResults";
import GameInfo from "@/components/GameInfo/GameInfo";
import MyLibrary from "@/components/MyLibrary/MyLibrary";
import Login from "@/components/Login/Login";
import Footer from "@/components/Footer/Footer";

//Más limpio sacar las props de la declaración de la función home, sino queda una guarrada verbosa.
type HomeProps = {
  searchParams: Promise<{
    q?: string;
    game?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  //ves.
  const { q, game } = await searchParams;

  const apiUrl = process.env.API_URL;

  const response = await fetch(
    `${apiUrl}/api/games?q=${encodeURIComponent(q ?? "")}`
  );

  const games = await response.json();

  const selectedGame = game
    ? await fetch(
        `${apiUrl}/api/games/${encodeURIComponent(game)}`
      ).then((res) => res.json())
    : undefined;

  return (
    <main className="min-h-screen bg-gray-100 py-8">
      <div className="mx-auto max-w-4xl px-6">
        <Header />
        <AIChat />
        <SearchBar />
        <SearchResults games={games} query={q} selectedSlug={game} />
        <GameInfo game={selectedGame} />
        <MyLibrary />
        <Login />
        <Footer />
      </div>
    </main>
  );
}

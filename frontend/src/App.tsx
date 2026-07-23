import Header from "./components/Header/Header";
import SearchBar from "./components/SearchBar/SearchBar";
import ResultsPanel from "./components/ResultsPanel/ResultsPanel";
import Footer from "./components/Footer/Footer";
import GameInfo from "./components/GameInfo/GameInfo";
import { useState } from "react";
import type { Game } from "./types/Game";
import type { SearchStatus } from "./types/SeachStatus";
import { searchGames } from "./services/GameService";

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");

  async function searchGame(text: string) {
    try {
      setSearchStatus("loading");
      const gamesFound = await searchGames(text);
      setGames(gamesFound);
      setSearchStatus("success");
    } catch (error) {
      console.error(error);
      setSearchStatus("error");
    }
  }

  return (
    <>
      <Header title="Tell Me What To Play" />
      <SearchBar onSearch={searchGame} />
      <ResultsPanel games={games} searchStatus={searchStatus} />
      <GameInfo />
      <Footer text="© 2026 Tell Me What To Play" />
    </>
  );
}

export default App;

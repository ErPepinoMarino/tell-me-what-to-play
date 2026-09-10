"use client";

import { useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useRecommendationTurns } from "@/lib/useRecommendationTurns";
import { describeRecommendationFailure } from "@/lib/recommendationErrorText";
import { introPhrases } from "@/lib/introPhrases";
import { gamePreviewFromRecommended } from "@/lib/gamePreview";
import { scrollToRefWithReducedMotion } from "@/lib/scroll";
import { useGameDetail } from "@/lib/useGameDetail";
import { useLibrary } from "@/lib/useLibrary";
import Header from "@/components/Header/Header";
import AIChat from "@/components/AIChat/AIChat";
import InputField from "@/components/InputField/InputField";
import SearchResults from "@/components/SearchResults/SearchResults";
import GameInfo from "@/components/GameInfo/GameInfo";
import MyLibrary from "@/components/MyLibrary/MyLibrary";
import Footer from "@/components/Footer/Footer";
import type { Game } from "@/types/Game";
import type { RecommendedGame } from "@/types/Recommendation";

type HomeClientProps = {
  initialGame: Game | null;
};

/*
 * Compositor de la página y dueño del ÚNICO estado compartido que no
 * pertenece a un hook (Decisión 3): la ficha seleccionada. `complete`
 * distingue la ficha del deep-link SSR (datos totales) de la vista
 * preliminar procedente de un card (el detalle la completa o el mismo
 * hook la obtiene vía GET /api/games/:slug). El shell (columna con
 * max-inline-size estable) jamás se desmonta: las secciones
 * aparecen/desaparecen verticalmente, nunca horizontalmente.
 */
type Selection = { game: Game; complete: boolean };

function HomeFlow({ initialGame }: HomeClientProps) {
  const { token } = useAuth();
  const turns = useRecommendationTurns({ token });
  const library = useLibrary(token);

  // Ficha seleccionada: el deep-link ?game= precarga por SSR (completa);
  // cualquier envío (search o more) la limpia — la atención vuelve a la
  // conversación.
  const [selection, setSelection] = useState<Selection | null>(
    initialGame ? { game: initialGame, complete: true } : null
  );
  const detail = useGameDetail(
    selection && !selection.complete ? selection.game.slug : null
  );
  const selectedGame = selection
    ? selection.complete
      ? selection.game
      : (detail.game ?? selection.game)
    : null;

  // Scroll a la ficha al seleccionar desde los resultados. El primer
  // render (deep-link SSR) no dispara scroll: el usuario no ha interactuado.
  const gameInfoAnchor = useRef<HTMLDivElement>(null);
  const skipFirstEffect = useRef(true);
  useEffect(() => {
    if (skipFirstEffect.current) {
      skipFirstEffect.current = false;
      return;
    }
    if (selection) scrollToRefWithReducedMotion(gameInfoAnchor);
  }, [selection]);

  // Modo demo vía URL (?demo=1): para portfolio/entrevistas técnicas. Solo
  // se puede leer window.location tras el montaje (en SSR no existe), por
  // eso el setState dentro del effect es intencional e inevitable aquí.
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemoMode(true);
    }
  }, []);

  // El mensaje del usuario ya se publica optimistamente dentro del hook.
  const clearAndSend = (action: "search" | "more", message: string) => {
    setSelection(null);
    // Limpiar la URL (shallow, sin navegación ni remontaje): la ficha
    // seleccionada ya no es realidad en la URL si la búsqueda la limpia.
    window.history.replaceState(null, "", "/");
    void turns.send(message, action);
  };

  const handleSelectGame = (game: RecommendedGame) => {
    setSelection({ game: gamePreviewFromRecommended(game), complete: false });
    // La ficha seleccionada es compartible: reflejar la URL (shallow, sin
    // navegación ni remontaje — el estado de la conversación sigue vivo).
    // replaceState (y no push): la URL siempre espeja lo que se muestra.
    window.history.replaceState(
      null,
      "",
      `/?game=${encodeURIComponent(game.slug)}`
    );
  };

  // Añadir a la biblioteca: ÚNICO hook compartido con MyLibrary para que
  // la lista refresque al instante. El id viene del JWT (sub): nunca se
  // opera sobre ids de la URL; el backend revalida con el token.
  const handleAddToLibrary = async (game: Game) => {
    return library.add(game.id);
  };

  return (
    <>
      <Header />

      {turns.status === "idle" && turns.transcript.length === 0 ? (
        /*
         * Hero de arranque: frases animadas a pantalla completa, sin panel,
         * directamente sobre el fondo. El panel AIChat aparece con la
         * primera interacción y no desaparece por defecto.
         */
        <section className="chat-hero" aria-label="Presentación">
          <div className="chat-hero-phrases">
            {introPhrases.map((phrase, index) => (
              <p
                key={index}
                className="chat-intro-phrase chat-hero-phrase"
                style={{
                  // Slot de 4s por frase dentro del ciclo completo.
                  animationDelay: `${index * 4}s`,
                  animationDuration: `${introPhrases.length * 4}s`,
                }}
              >
                {phrase}
              </p>
            ))}
          </div>
        </section>
      ) : (
        <AIChat
          status={turns.status}
          transcript={turns.transcript}
          intent={turns.intent}
          notices={turns.notices}
          demoMode={demoMode}
          relaxedFilters={turns.meta?.relaxedFilters ?? []}
        />
      )}

      {turns.failure ? (
        <p className="notice notice-error">
          {describeRecommendationFailure(turns.failure.status)}
        </p>
      ) : null}

      <InputField
        onSubmit={(message) => clearAndSend("search", message)}
        onMore={() => clearAndSend("more", "dame más")}
        canMore={turns.canMore}
        busy={turns.busy}
      />

      <SearchResults
        results={turns.results}
        requestedGames={turns.requestedGames}
        requestedKeywords={turns.intent?.keywords ?? []}
        demoMode={demoMode}
        searching={turns.busy}
        meta={turns.meta}
        onSelectGame={handleSelectGame}
      />

      <div ref={gameInfoAnchor}>
        <GameInfo game={selectedGame} onAddToLibrary={handleAddToLibrary} />
      </div>
      <MyLibrary
        entries={library.entries}
        update={library.update}
        remove={library.remove}
      />
      <Footer />

      <div className="demo-toggle">
        <button
          type="button"
          className="button-secondary"
          onClick={() => setDemoMode((previous) => !previous)}
        >
          {demoMode ? "Salir del modo demo" : "Modo demo técnico"}
        </button>
      </div>
    </>
  );
}

export default function HomeClient({ initialGame }: HomeClientProps) {
  return (
    <AuthProvider>
      <HomeFlow initialGame={initialGame} />
    </AuthProvider>
  );
}

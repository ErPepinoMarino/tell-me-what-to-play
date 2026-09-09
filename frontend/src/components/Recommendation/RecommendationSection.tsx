"use client";

import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { postStream } from "@/lib/api";
import type {
  RecommendationAction,
  RecommendationMeta,
  RecommendationResponse,
  RecommendationResultItem,
  RecommendedGame,
  GameSearchIntent,
  NoticeCode,
} from "@/types/Recommendation";
import AIChat, {
  type ChatStatus,
  type TranscriptMessage,
} from "@/components/AIChat/AIChat";
import SearchBar from "@/components/SearchBar/SearchBar";
import RecommendationResults from "@/components/SearchResults/RecommendationResults";
import {
  DemoMetaPanel,
  RequestedGamesRow,
} from "@/components/SearchResults/RecommendationExtras";
import Login from "@/components/Login/Login";

/*
 * USER INPUT → POST /api/recommendations → SEARCH RESULTS + AI CHAT.
 * Dueño del estado de la conversación en el cliente. El contexto real de
 * sesión (intención, mostrados) vive en el backend (memoria, 30 min): aquí
 * solo transcript y última respuesta. Sin almacenamiento adicional.
 */
function RecommendationFlow() {
  const { token, status: authStatus } = useAuth();

  const [status, setStatus] = useState<ChatStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [results, setResults] = useState<RecommendationResultItem[]>([]);
  const [requestedGames, setRequestedGames] = useState<RecommendedGame[]>([]);
  const [intent, setIntent] = useState<GameSearchIntent | null>(null);
  const [meta, setMeta] = useState<RecommendationMeta | null>(null);
  const [notices, setNotices] = useState<NoticeCode[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El CLIENTE es el dueño del contexto efímero: ids ya mostrados en este
  // hilo. El servidor ya no guarda sesión; esto viaja en cada request.
  const [shownGameIds, setShownGameIds] = useState<number[]>([]);

  // Modo demo vía URL (?demo=1): para portfolio/entrevistas técnicas. Solo
  // se puede leer window.location tras el montaje (en SSR no existe), por
  // eso el setState dentro del effect es intencional e inevitable aquí.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemoMode(true);
    }
  }, []);

  function applyResponse(response: RecommendationResponse) {
    // "more" entrega una TANDA NUEVA de hasta 8 (contrato del backend):
    // reemplaza, no acumula.
    setResults(response.results);
    setRequestedGames(response.requestedGames);
    setMeta(response.meta);
    setNotices(response.notices);

    /*
     * El cliente es el dueño del contexto efímero. Solo con resultados se
     * adopta el intent devuelto y se actualiza el listado de mostrados según
     * el ciclo de vida: "reset" (búsqueda NUEVA) vacía los mostrados;
     * "continue" (refine/more) los acumula. Sin resultados (gate, intención
     * vacía o error) se conserva el contexto previo tal cual.
     */
    const thisTurnShown = [
      ...response.results.map((item) => item.game.id),
      ...response.requestedGames.map((game) => game.id),
    ];
    if (response.results.length > 0) {
      setIntent(response.intent);
      setShownGameIds((previous) =>
        response.meta.lifecycle === "reset"
          ? thisTurnShown
          : Array.from(new Set([...previous, ...thisTurnShown])),
      );
    }

    // El mensaje del usuario ya se publicó optimistamente en send(): solo
    // falta la respuesta del asistente.
    setTranscript((previous) => [
      ...previous,
      { role: "assistant", text: response.explanation },
    ]);
  }

  function applyFailure(failure: {
    status: number;
    message?: string;
    notice?: string;
  }) {
    const message =
      failure.status === 502
        ? "El intérprete no está disponible ahora mismo. Inténtalo de nuevo en un momento."
        : failure.status === 503
          ? "El motor de recomendación no está configurado todavía."
          : failure.status === 0
            ? "No he podido contactar con el servidor. Revisa tu conexión."
            : "Algo ha ido mal. Inténtalo de nuevo.";
    setError(message);
  }

  async function send(message: string, action: RecommendationAction) {
    setStatus("searching");
    setError(null);
    // Mensaje del usuario OPTIMISTA: visible en el chat desde el envío,
    // no cuando llega la respuesta.
    setTranscript((previous) => [...previous, { role: "user", text: message }]);
    // Capa 2/3 de traza de streaming (eventos aplicados). t0 común con
    // la capa 1 (transporte, en postStream) para correlacionar.
    const t0 = performance.now();

    // Streaming: intent y tandas rankeadas van pintándose al llegar; lo ya
    // mostrado se conserva aunque el stream falle a mitad (mejor parcial
    // honesto que todo-o-nada). El done final trae la respuesta completa.
    let streamError: { status: number; message?: string; notice?: string } | null =
      null;
    const result = await postStream(
      "/api/recommendations/stream",
      {
        message,
        action,
        // Última intención conocida (la que muestran los chips): el backend la
        // usa para clasificar refine-vs-new y como previo del refinado.
        contextIntent: intent,
        // Ids ya mostrados en este hilo: el backend los excluye en "more".
        shownGameIds,
      },
      token,
      (event) => {
        if (event.event === "intent") {
          console.debug("[stream] event", {
            event: "intent",
            t: Math.round(performance.now() - t0),
          });
          setIntent(event.intent);
        } else if (event.event === "results") {
          console.debug("[stream] event", {
            event: "results",
            count: event.results.length,
            ids: event.results.map((item) => item.game.id),
            t: Math.round(performance.now() - t0),
          });
          setResults(event.results);
        } else if (event.event === "done") {
          console.debug("[stream] event", {
            event: "done",
            count: event.response.results.length,
            t: Math.round(performance.now() - t0),
          });
          applyResponse(event.response);
        } else if (event.event === "error") {
          streamError = {
            status: event.status,
            message: event.message,
            notice: event.notice,
          };
        }
      }
    );

    if (!result.ok) {
      applyFailure(result);
      setStatus("error");
    } else if (streamError) {
      applyFailure(streamError);
      setStatus("error");
    } else {
      setStatus("ready");
    }
  }

  const authenticated = authStatus === "authenticated";
  // El botón "más" solo actúa tras una búsqueda que arrojó resultados y no
  // haya agotado el pool. Ya NO exige login: un anónimo también puede pedir más.
  const canMore = results.length > 0 && meta !== null && !meta.exhaustedPool;

  return (
    <>
      <AIChat
        status={status}
        transcript={transcript}
        intent={intent}
        notices={notices}
        demoMode={demoMode}
        relaxedFilters={meta?.relaxedFilters ?? []}
      />

      {error ? <p className="notice notice-error">{error}</p> : null}

      <SearchBar
        onSubmit={(message) => void send(message, "search")}
        onMore={() => void send("dame más", "more")}
        canMore={canMore}
        authenticated={authenticated}
        busy={status === "searching"}
      />

      <RequestedGamesRow games={requestedGames} />
      <RecommendationResults
        results={results}
        demoMode={demoMode}
        searching={status === "searching"}
      />
      {demoMode && meta ? <DemoMetaPanel meta={meta} /> : null}

      <div className="demo-toggle">
        <button
          type="button"
          className="button-secondary"
          onClick={() => setDemoMode((previous) => !previous)}
        >
          {demoMode ? "Salir del modo demo" : "Modo demo técnico"}
        </button>
      </div>

      <Login />
    </>
  );
}

export default function RecommendationSection() {
  return (
    <AuthProvider>
      <RecommendationFlow />
    </AuthProvider>
  );
}

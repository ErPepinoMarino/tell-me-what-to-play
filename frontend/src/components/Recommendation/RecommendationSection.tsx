"use client";

import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { postJson } from "@/lib/api";
import type {
  RecommendationAction,
  RecommendationMeta,
  RecommendationResponse,
  RecommendationResultItem,
  RecommendedGame,
  GameSearchIntent,
  NoticeCode,
} from "@/types/Recommendation";
import AIChat, { type ChatStatus, type TranscriptMessage } from "@/components/AIChat/AIChat";
import SearchBar from "@/components/SearchBar/SearchBar";
import RecommendationResults from "@/components/SearchResults/RecommendationResults";
import { DemoMetaPanel, RequestedGamesRow } from "@/components/SearchResults/RecommendationExtras";
import Login from "@/components/Login/Login";

/*
 * USER INPUT → POST /api/recommendations → SEARCH RESULTS + AI CHAT.
 * Dueño del estado de la conversación en el cliente. El contexto real de
 * sesión (intención, mostrados) vive en el backend (memoria, 30 min): aquí
 * solo transcript y última respuesta. Sin almacenamiento adicional.
 */
function RecommendationFlow() {
  const { token, status: authStatus, login } = useAuth();

  const [status, setStatus] = useState<ChatStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [results, setResults] = useState<RecommendationResultItem[]>([]);
  const [requestedGames, setRequestedGames] = useState<RecommendedGame[]>([]);
  const [intent, setIntent] = useState<GameSearchIntent | null>(null);
  const [meta, setMeta] = useState<RecommendationMeta | null>(null);
  const [notices, setNotices] = useState<NoticeCode[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modo demo vía URL (?demo=1): para portfolio/entrevistas técnicas. Solo
  // se puede leer window.location tras el montaje (en SSR no existe), por
  // eso el setState dentro del effect es intencional e inevitable aquí.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemoMode(true);
    }
  }, []);

  function applyResponse(
    response: RecommendationResponse,
    userMessage: string,
    action: RecommendationAction,
  ) {
    if (action === "more") {
      setResults((previous) => [...previous, ...response.results]);
    } else {
      setResults(response.results);
    }
    setRequestedGames(response.requestedGames);
    setIntent(response.intent);
    setMeta(response.meta);
    setNotices(response.notices);
    setTranscript((previous) => [
      ...previous,
      { role: "user", text: userMessage },
      { role: "assistant", text: response.explanation },
    ]);
  }

  function applyFailure(failure: {
    status: number;
    message?: string;
    notice?: string;
  }) {
    if (failure.status === 401) {
      setTranscript((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "Eso requiere sesión iniciada: con ella puedes afinar la búsqueda, pedir más resultados y cambiar de tema.",
        },
      ]);
      login();
      return;
    }
    if (failure.status === 400 && failure.notice === "SESSION_EXPIRED") {
      setTranscript((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "Tu búsqueda anterior ha expirado (30 min sin actividad). Lanza una búsqueda nueva y seguimos.",
        },
      ]);
      return;
    }
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

    const result = await postJson<RecommendationResponse>(
      "/api/recommendations",
      { message, action },
      token,
    );

    if (result.ok) {
      applyResponse(result.data, message, action);
      setStatus("ready");
    } else {
      applyFailure(result);
      setStatus("error");
    }
  }

  const authenticated = authStatus === "authenticated";
  const canMore = authenticated && meta !== null && !meta.exhaustedPool;

  return (
    <>
      <AIChat
        status={status}
        transcript={transcript}
        intent={intent}
        notices={notices}
        demoMode={demoMode}
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

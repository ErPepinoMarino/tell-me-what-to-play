"use client";

import { useState } from "react";
import type { Game } from "@/types/Game";
import Image from "next/image";
import GameInfoBody, {
  PLACEHOLDER_COVER,
} from "@/components/GameInfo/GameInfoBody";
import { useAuth } from "@/lib/auth";
import type { AddToLibraryOutcome } from "@/lib/useLibrary";

type GameInfoProps = {
  game?: Game | null;
  onAddToLibrary: (game: Game) => Promise<AddToLibraryOutcome>;
};

/*
 * Ficha completa (A4): tabla de 2 columnas — título, año e imagen
 * (doble tamaño de card) a la izquierda; el cuerpo informativo
 * (GameInfoBody) y la acción a la derecha. Sin ficha no se renderiza.
 */
export default function GameInfo({ game, onAddToLibrary }: GameInfoProps) {
  const { status, login } = useAuth();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!game) {
    // Sin ficha seleccionada no se renderiza nada.
    return null;
  }

  async function handleAdd() {
    if (!game || busy) return;
    setBusy(true);
    const outcome = await onAddToLibrary(game);
    setBusy(false);
    setFeedback(
      outcome === "added"
        ? "Añadido a tu biblioteca."
        : outcome === "exists"
          ? "Ya está en tu biblioteca."
          : "No se pudo añadir. Inténtalo de nuevo."
    );
  }

  return (
    <section className="game-info">
      <div className="game-info-layout">
        {/* Columna izquierda: SOLO imagen (el título vive en la derecha). */}
        <div className="game-info-media">
          <Image
            src={game.coverUrl || PLACEHOLDER_COVER}
            alt={game.title}
            width={300}
            height={450}
            priority
          />
        </div>

        {/* Columna derecha: título (año) + cuerpo; la acción queda pegada
         al margen inferior de la tabla (margin-top auto). */}
        <div className="game-info-content">
          <h3 className="game-info-heading">
            {game.title}
            {game.releaseYear ? (
              <span className="muted"> ({game.releaseYear})</span>
            ) : null}
          </h3>

          <GameInfoBody game={game} />

          {status === "authenticated" ? (
            <div className="game-info-cta">
              <button
                type="button"
                className="button-add"
                onClick={() => void handleAdd()}
                disabled={busy}
              >
                {busy ? "Añadiendo..." : "Añadir a la lista"}
              </button>
              {feedback ? (
                <p className="muted game-info-feedback">{feedback}</p>
              ) : null}
            </div>
          ) : (
            <div className="game-info-cta">
              <p className="muted">
                Inicia sesión para añadir este juego a tu biblioteca.
              </p>
              <button
                type="button"
                className="button-secondary"
                onClick={login}
              >
                Continuar con Google
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

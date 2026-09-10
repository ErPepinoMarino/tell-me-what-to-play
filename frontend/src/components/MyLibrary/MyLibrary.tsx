"use client";

import { useState } from "react";
import Image from "next/image";
import GameInfoBody, {
  PLACEHOLDER_COVER,
} from "@/components/GameInfo/GameInfoBody";
import { useAuth } from "@/lib/auth";
import type {
  LibraryEntry,
  Recommendation,
  UserGameStatus,
} from "@/types/Library";

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

type LibraryEntryPatch = {
  status?: UserGameStatus;
  recommendation?: Recommendation;
  review?: string | null;
};

type MyLibraryProps = {
  entries: LibraryEntry[] | null;
  update: (gameId: number, body: Record<string, unknown>) => Promise<boolean>;
  remove: (gameId: number) => Promise<boolean>;
};

const STATUS_LABELS: Record<UserGameStatus, string> = {
  PENDING: "Pendiente",
  PLAYED: "Jugado",
  COMPLETED: "Completado",
};

const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  HIGHLY_RECOMMENDED: "Muy recomendado",
  RECOMMENDED: "Recomendado",
  MEH: "Paso",
  NOT_RECOMMENDED: "No recomendado",
};

/*
 * Cuerpo del PUT según el contrato del backend (missing → null en BD):
 * siempre porta los valores vigentes; los valores null vigentes se
 * OMITEN (omitir ≡ null). Borrar reseña = omitir la clave review.
 */
function buildUpdateBody(
  entry: LibraryEntry,
  patch: LibraryEntryPatch
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const nextStatus = patch.status !== undefined ? patch.status : entry.status;
  if (nextStatus) body.status = nextStatus;
  const nextRecommendation =
    patch.recommendation !== undefined
      ? patch.recommendation
      : entry.recommendation;
  if (nextRecommendation) body.recommendation = nextRecommendation;
  if (patch.review === null) {
    // Borrar reseña: omitir la clave (el backend escribe null).
  } else if (typeof patch.review === "string") {
    if (patch.review.trim().length > 0) body.review = patch.review.trim();
  } else if (entry.review) {
    // Otros cambios: preservar la reseña vigente.
    body.review = entry.review;
  }
  return Object.keys(body).length === 0 ? null : body;
}

export default function MyLibrary({ entries, update, remove }: MyLibraryProps) {
  const { status } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Accesible solo para usuarios autenticados.
  if (status !== "authenticated") {
    return null;
  }

  const selected =
    entries?.find((entry) => entry.game_id === selectedId) ?? null;

  const toggle = (gameId: number) => {
    setSelectedId((previous) => (previous === gameId ? null : gameId));
  };

  return (
    <section>
      {entries === null ? (
        <p className="muted">Cargando tu biblioteca...</p>
      ) : entries.length === 0 ? (
        <p className="muted">Todavía no has guardado ningún juego.</p>
      ) : (
        <>
          <div className="library-row">
            {entries.map((entry) => (
              <button
                key={entry.game_id}
                type="button"
                className={`library-card${
                  entry.game_id === selectedId ? " library-card-selected" : ""
                }`}
                onClick={() => toggle(entry.game_id)}
              >
                <h3>{entry.games.title}</h3>
                {entry.games.releaseYear ? (
                  <p className="muted">{entry.games.releaseYear}</p>
                ) : null}
                <Image
                  src={entry.games.coverUrl || PLACEHOLDER}
                  alt={entry.games.title}
                  width={100}
                  height={150}
                />
              </button>
            ))}
          </div>

          {selected ? (
            <LibraryDetail
              key={selected.game_id}
              entry={selected}
              update={update}
              remove={remove}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

type LibraryDetailProps = {
  entry: LibraryEntry;
  update: (gameId: number, body: Record<string, unknown>) => Promise<boolean>;
  remove: (gameId: number) => Promise<boolean>;
  onClose: () => void;
};

function LibraryDetail({ entry, update, remove, onClose }: LibraryDetailProps) {
  // El remonte con key={game_id} (en el padre) reinicia el draft al
  // cambiar de juego seleccionado — no hace falta effect.
  const [draft, setDraft] = useState(entry.review ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function commit(patch: LibraryEntryPatch) {
    if (busy) return;
    const body = buildUpdateBody(entry, patch);
    if (!body) return;
    setBusy(true);
    const ok = await update(entry.game_id, body);
    setBusy(false);
    setNote(ok ? "Guardado." : "No se pudo guardar. Inténtalo de nuevo.");
  }

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    const ok = await remove(entry.game_id);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="library-detail">
      <div className="game-info-layout">
        <div className="game-info-media">
          <h3 className="game-info-title">{entry.games.title}</h3>
          {entry.games.releaseYear ? (
            <span className="game-info-year">{entry.games.releaseYear}</span>
          ) : null}
          <Image
            src={entry.games.coverUrl || PLACEHOLDER_COVER}
            alt={entry.games.title}
            width={300}
            height={450}
          />
        </div>

        <div className="game-info-content">
          <GameInfoBody game={entry.games} />

          <div>
            <span className="game-info-label">Estado</span>
            <div className="library-options">
              {(Object.keys(STATUS_LABELS) as UserGameStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    className={`button-secondary${
                      entry.status === status ? " library-option-active" : ""
                    }`}
                    onClick={() => void commit({ status })}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                )
              )}
            </div>
          </div>

          <div>
            <span className="game-info-label">Valoración</span>
            <div className="library-options">
              {(Object.keys(RECOMMENDATION_LABELS) as Recommendation[]).map(
                (recommendation) => (
                  <button
                    key={recommendation}
                    type="button"
                    className={`button-secondary${
                      entry.recommendation === recommendation
                        ? " library-option-active"
                        : ""
                    }`}
                    onClick={() => void commit({ recommendation })}
                  >
                    {RECOMMENDATION_LABELS[recommendation]}
                  </button>
                )
              )}
            </div>
          </div>

          <div>
            <span className="game-info-label">Reseña</span>
            <textarea
              className="library-review"
              value={draft}
              maxLength={1000}
              placeholder="Escribe tu opinión sobre el juego..."
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Tu reseña"
            />
            <div className="library-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy || draft.trim().length === 0}
                onClick={() => void commit({ review: draft })}
              >
                Guardar reseña
              </button>
              {entry.review ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void commit({ review: null })}
                >
                  Borrar reseña
                </button>
              ) : null}
            </div>
            {note ? <p className="muted">{note}</p> : null}
          </div>

          <div className="library-actions">
            <button
              type="button"
              className="button-secondary button-danger"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              Quitar de la biblioteca
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

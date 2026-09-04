"use client";

import { useState, type SyntheticEvent } from "react";
import type { RecommendationAction } from "@/types/Recommendation";

type SearchBarProps = {
  onSubmit: (message: string) => void;
  onMore: () => void;
  pendingAction: Exclude<RecommendationAction, "more">;
  onPendingActionChange: (
    action: Exclude<RecommendationAction, "more">
  ) => void;
  canMore: boolean;
  authenticated: boolean;
  busy: boolean;
};

const PLACEHOLDERS: Record<Exclude<RecommendationAction, "more">, string> = {
  search: "¿A qué te apetece jugar?",
  refine: "¿Qué cambiamos? (p. ej. menos violento)",
  pivot: "Nuevo tema (p. ej. un RPG cozy)",
};

const ACTION_HINTS: Record<Exclude<RecommendationAction, "more">, string> = {
  search: "Búsqueda nueva",
  refine: "Modifica tu intención actual",
  pivot: "Olvida el tema y empieza otro",
};

/*
 * USER INPUT: texto libre + chips de acción. La acción se envía explícita
 * al backend (V1: el cliente decide si es búsqueda, refine o pivot).
 * "Más así" reusa la intención de sesión excluyendo lo ya mostrado.
 */
export default function SearchBar({
  onSubmit,
  onMore,
  pendingAction,
  onPendingActionChange,
  canMore,
  authenticated,
  busy,
}: SearchBarProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = value.trim();
    if (message.length === 0 || busy) return;
    onSubmit(message);
    setValue("");
  }

  const actions: Exclude<RecommendationAction, "more">[] = [
    "search",
    "refine",
    "pivot",
  ];

  return (
    <section className="search-bar">
      <div className="action-chips" role="tablist">
        {actions.map((action) => {
          const needsAuth = action !== "search" && !authenticated;
          return (
            <button
              key={action}
              type="button"
              disabled={needsAuth || busy}
              title={
                needsAuth
                  ? "Inicia sesión para afinar o cambiar de tema"
                  : ACTION_HINTS[action]
              }
              className={
                pendingAction === action ? "action-chip active" : "action-chip"
              }
              onClick={() => onPendingActionChange(action)}
            >
              {action === "search"
                ? "Buscar"
                : action === "refine"
                  ? "Afinar"
                  : "Otro tema"}
            </button>
          );
        })}
        <button
          type="button"
          disabled={!canMore || !authenticated || busy}
          title={
            authenticated
              ? "Más resultados con la misma intención"
              : "Inicia sesión para pedir más resultados"
          }
          className="action-chip"
          onClick={onMore}
        >
          Más así
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          maxLength={500}
          placeholder={PLACEHOLDERS[pendingAction]}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Tu petición"
        />
        <button
          type="submit"
          disabled={busy || value.trim().length === 0}
          className="button-primary"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}

"use client";

import { useState, type SyntheticEvent } from "react";

type SearchBarProps = {
  onSubmit: (message: string) => void;
  onMore: () => void;
  canMore: boolean;
  authenticated: boolean;
  busy: boolean;
};

/*
 * USER INPUT: texto libre + dos acciones. El backend (LLM) decide con el
 * contexto de sesión si el mensaje extiende la búsqueda anterior o empieza
 * otra: afinar o cambiar de tema no es decisión del cliente. "Más así"
 * repite la intención de sesión excluyendo lo ya mostrado (requiere sesión).
 */
export default function SearchBar({
  onSubmit,
  onMore,
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

  return (
    <section className="search-bar">
      <button
        type="button"
        disabled={!canMore || !authenticated || busy}
        title={
          authenticated
            ? "Más resultados con la misma intención"
            : "Inicia sesión para pedir más resultados"
        }
        className="button-secondary"
        onClick={onMore}
      >
        Mostrar más juegos
      </button>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          maxLength={500}
          placeholder="¿A qué te apetece jugar?"
          onChange={(event) => setValue(event.target.value)}
          aria-label="Tu petición"
        />
        <button
          type="submit"
          disabled={busy || value.trim().length === 0}
          className="button-primary"
        >
          Buscar
        </button>
      </form>
    </section>
  );
}

"use client";

import { useState, type SyntheticEvent } from "react";

type InputFieldProps = {
  onSubmit: (message: string) => void;
  onMore: () => void;
  canMore: boolean;
  busy: boolean;
};

/*
 * USER INPUT: texto libre + dos acciones. El backend (LLM) decide con el
 * contexto de sesión si el mensaje extiende la búsqueda anterior o empieza
 * otra: afinar o cambiar de tema no es decisión del cliente. "Mostrar más
 * resultados" repite la intención de sesión excluyendo lo ya mostrado.
 *
 * Reglas de producto:
 * - "more" deshabilitado hasta que una búsqueda devuelva ≥1 resultado
 *   (canMore lo refleja: results > 0, meta presente y pool no agotado).
 * - Decisión de producto: "more" también para anónimos — no exige login.
 * - No presenta resultados ni chat: solo entrada y envío.
 */
export default function InputField({
  onSubmit,
  onMore,
  canMore,
  busy,
}: InputFieldProps) {
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

      {/* En línea, a la derecha de Buscar. Con el glow de borde giratorio
          cuando está habilitado (hay resultados y pool no agotado). */}
      <button
        type="button"
        disabled={!canMore || busy}
        title="Más resultados con la misma intención"
        className={`search-more${!canMore || busy ? "" : " border-glow-active"}`}
        onClick={onMore}
      >
        Mostrar más juegos
      </button>
    </section>
  );
}

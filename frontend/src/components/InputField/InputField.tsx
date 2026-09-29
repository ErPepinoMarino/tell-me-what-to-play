"use client";

import { useState, type SyntheticEvent } from "react";

type InputFieldProps = {
  onSubmit: (message: string) => void;
  onMore: () => void;
  canMore: boolean;
  busy: boolean;
};

/*
 * USER INPUT: texto libre + dos acciones. El backend (LLM) decide si el mensaje
 * extiende la búsqueda anterior o empieza otra; "más" repite la intención
 * excluyendo lo mostrado.
 * "more" requiere ≥1 resultado (canMore) pero NO login. No pinta resultados.
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
    <section className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={handleSubmit}
        className="flex min-w-0 flex-1 gap-2 max-[600px]:order-1 max-[600px]:[flex:1_1_100%]"
      >
        <input
          type="text"
          value={value}
          maxLength={500}
          placeholder="¿A qué te apetece jugar?"
          onChange={(event) => setValue(event.target.value)}
          aria-label="Tu petición"
          className="min-w-0 flex-1 rounded-lg border border-[#444] bg-transparent px-[0.9rem] py-[0.6rem] text-inherit [font:inherit]"
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
        className={`shrink-0 max-[600px]:order-2 max-[600px]:[flex:1_1_100%]${
          !canMore || busy ? "" : " border-glow-active"
        }`}
        onClick={onMore}
      >
        Mostrar más juegos
      </button>
    </section>
  );
}

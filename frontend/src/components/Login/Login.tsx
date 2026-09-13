"use client";

import { useAuth } from "@/lib/auth";

/*
 * Estado de sesión + CTA. Anónimo se le recuerda qué gana al iniciar
 * sesión (más resultados, historial de sesión); autenticado puede cerrar.
 */
export default function Login() {
  const { status, login, logout } = useAuth();

  if (status === "loading") {
    return null;
  }

  if (status === "authenticated") {
    return (
      <section className="flex items-center justify-between gap-4">
        <p className="text-[0.9rem] text-muted">Sesión iniciada: puedes afinar, pedir más y cambiar de tema.</p>
        <button type="button" onClick={() => void logout()} className="button-secondary">
          Cerrar sesión
        </button>
      </section>
    );
  }

  return (
    <section className="flex items-center justify-between gap-4">
      <p className="text-[0.9rem] text-muted">
        Inicia sesión para afinar tus búsquedas, pedir más resultados y
        cambiar de tema sin perder el contexto.
      </p>
      <button type="button" onClick={login} className="button-google">
        Continuar con Google
      </button>
    </section>
  );
}

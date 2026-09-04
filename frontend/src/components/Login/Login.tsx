"use client";

import { useAuth } from "@/lib/auth";

/*
 * Estado de sesión + CTA. Anónimo se le recuerda qué gana al iniciar
 * sesión (refine/more/pivot, historial de sesión); autenticado puede cerrar.
 */
export default function Login() {
  const { status, login, logout } = useAuth();

  if (status === "loading") {
    return null;
  }

  if (status === "authenticated") {
    return (
      <section className="login">
        <p>Sesión iniciada: puedes afinar, pedir más y cambiar de tema.</p>
        <button type="button" onClick={logout} className="button-secondary">
          Cerrar sesión
        </button>
      </section>
    );
  }

  return (
    <section className="login">
      <p>
        Inicia sesión para afinar tus búsquedas, pedir más resultados y
        cambiar de tema sin perder el contexto.
      </p>
      <button type="button" onClick={login} className="button-primary">
        Continuar con Google
      </button>
    </section>
  );
}

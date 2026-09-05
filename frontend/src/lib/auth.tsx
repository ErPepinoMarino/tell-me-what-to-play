/*
 * Auth del cliente web: el access token vive SOLO en memoria (nunca en
 * localStorage).
 * La persistencia la pone la cookie httpOnly del refresh.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Esta interfaz contiene el token, estado y metodos de login/logout/refresh, sencillo.
// Como siempre, usamos una interfaz para que sea más fácil de testear y mockear en tests unitarios.
// Lo llevamos haciendo en todo el proyecto. En los tests fakeamos un AuthValue para que conteste lo que nos de la gana.
interface AuthValue {
  token: string | null;
  status: "loading" | "authenticated" | "anonymous";
  login: () => void;
  logout: () => Promise<void>;
  // Renueva el access token (cookie) y devuelve el nuevo; null si anónimo.
  refreshToken: () => Promise<string | null>;
}

//Mira al final de la pagina. Se usa en useAuth(), ahí lo explico.
const AuthContext = createContext<AuthValue | null>(null);

// Funcion que gestiona el estado de los tokens, de nuestra autenticación, y asigna funciones de refreshtoken, login y logout.
// SE ejecuta al cargar la pagina, y cuando cambian el token o el status.
export function AuthProvider({ children }: { children: ReactNode }) {
  // Si el valor de token ha variado desde la ultima renderización, ocurre algo que opencode me va a EXPLICar.
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthValue["status"]>("loading");

  // Recordatorio para los que venimos de C#
  // Aquí no ejecutamos ninguna funcion, estamos asignando una funcion useCallback a una variable.
  // La funcion se ejecutara cuando haganos "refreshToken()"
  const refreshToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/auth/refresh", { method: "POST" });
      if (!response.ok) {
        setToken(null);
        setStatus("anonymous");
        return null;
      }
      const body = (await response.json()) as { accessToken?: string };
      if (!body.accessToken) {
        setToken(null);
        setStatus("anonymous");
        return null;
      }
      setToken(body.accessToken);
      setStatus("authenticated");
      return body.accessToken;
    } catch {
      setToken(null);
      setStatus("anonymous");
      return null;
    }
  }, []);

  // Se ejecuta al cargar la pagina solo una vez y lanza refreshToken() y de nuevo en cada carga completa de página (F5, vuelta de Google)"
  // lo de void y [refreshToken] es la forma de evitar problemas ya que refresToken devuelve un promise y useEffect no espera promesas.
  // El array de dependencias [refreshToken] es para que se ejecute solo una vez, ya que refreshToken es estable gracias a useCallback.
  //
  // set-state-in-effect es un falso positivo controlado: los setState de
  // refreshToken ocurren SIEMPRE tras await fetch (continuación asíncrona),
  // nunca de forma síncrona en el cuerpo del efecto — el patrón legítimo de
  // "sincronizar con un sistema externo al montar" (https://react.dev/learn/you-might-not-need-an-effect).
  // El linter no puede seguir la asincronía a través de la función extraída.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshToken();
  }, [refreshToken]);

  // Como arriba. Asignamos funcion que dispara la autenticacion a una variable.
  const login = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  // Lo mismo, al pulsar logout, avisamos al backend para que revoque la
  // sesión y borre la cookie httpOnly, y después limpiamos la memoria.
  // Best-effort: si la llamada falla la cookie persiste y el F5 re-loginea
  // (el usuario puede reintentar); el refresh token NUNCA se borra de la
  // memoria por sí solo porque vive en la cookie, no en JS.
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    setToken(null);
    setStatus("anonymous");
  }, []);

  // useMemo hará que value cambie solo si token, status cambian.
  const value = useMemo(
    () => ({ token, status, login, logout, refreshToken }),
    [token, status, login, logout, refreshToken]
  );
  // Devolvemos el provider, {children} es RecommendationFlow.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// RecommendationFlow llama a esta funcion para asegurarse de que su componente
// esta dentro de Authcontext.Provider, ya que accede a variables de contexto. Si no lo esta, lanza un error.
export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return context;
}

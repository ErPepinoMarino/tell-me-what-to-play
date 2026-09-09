// Cliente mínimo de la API pública. El token Bearer va solo en memoria
// (ver lib/auth.tsx); en 401 con token intenta un refresh y repite una vez,
// para sobrevivir a la expiración de 15 min del access token sin sacar al
// usuario de la conversación.

import type { RecommendationStreamEvent } from "@/types/Recommendation";

interface ApiFailure {
  ok: false;
  status: number;
  message?: string;
  notice?: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// Response es el objeto predefinido de la API Fetch
// Tiene status, statusText, headers, etc. y métodos como json(), text(), blob()...
// En este caso tratamos de parsear el body como JSON, pero si falla devolvemos un objeto vacío para evitar errores de parseo.
async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  token: string | null,
  retried = false
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "network-error" };
  }

  if (response.status === 401 && token && !retried) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) {
      const refreshedBody = (await refreshed.json()) as {
        accessToken?: string;
      };
      if (refreshedBody.accessToken) {
        return postJson<T>(path, body, refreshedBody.accessToken, true);
      }
    }
  }

  const data = (await parseBody(response)) as {
    message?: string;
    notice?: string;
  };

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: data?.message,
      notice: data?.notice,
    };
  }

  return { ok: true, data: data as T };
}

/*
 * POST con respuesta SSE (ver POST /api/recommendations/stream): entrega
 * cada evento al handler conforme llega (intent → tandas → done) y resuelve
 * ok:true al cerrarse limpio. Los fallos HTTP previos al primer byte y los
 * cortes de transporte resuelven ApiFailure (lo ya mostrado se conserva:
 * el llamador NO limpia). Misma política de refresh 401 que postJson.
 */
export async function postStream(
  path: string,
  body: unknown,
  token: string | null,
  onEvent: (event: RecommendationStreamEvent) => void,
  retried = false
): Promise<ApiResult<null>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "network-error" };
  }

  if (response.status === 401 && token && !retried) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) {
      const refreshedBody = (await refreshed.json()) as {
        accessToken?: string;
      };
      if (refreshedBody.accessToken) {
        return postStream(path, body, refreshedBody.accessToken, onEvent, true);
      }
    }
  }

  if (!response.ok || !response.body) {
    const data = (await parseBody(response)) as {
      message?: string;
      notice?: string;
    };
    return {
      ok: false,
      status: response.status,
      message: data?.message,
      notice: data?.notice,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const t0 = performance.now();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Capa 1/3 de traza de streaming (transporte): cada trozo crudo con
      // su tamaño y tiempo. Oculto por defecto (console.debug = Verbose).
      console.debug("[stream] frame", {
        bytes: value.byteLength,
        t: Math.round(performance.now() - t0),
      });
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart());
        if (dataLines.length === 0) continue;
        try {
          onEvent(JSON.parse(dataLines.join("\n")));
        } catch {
          // Frame corrupto: se ignora sin tumbar el stream.
        }
      }
    }
  } catch {
    return { ok: false, status: 0, message: "network-error" };
  } finally {
    reader.releaseLock();
  }
  console.debug("[stream] closed", { t: Math.round(performance.now() - t0) });
  return { ok: true, data: null };
}

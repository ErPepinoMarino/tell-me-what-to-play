// Cliente mínimo de la API pública. El token Bearer va solo en memoria
// (ver lib/auth.tsx); en 401 con token intenta un refresh y repite una vez,
// para sobrevivir a la expiración de 15 min del access token sin sacar al
// usuario de la conversación.

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

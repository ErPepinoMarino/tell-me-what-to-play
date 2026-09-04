import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient, HttpResponse } from "../../src/igdb/types.js";
import { HttpIgdbClient } from "../../src/igdb/client.js";
import {
  IgdbAuthError,
  IgdbRateLimitError,
  IgdbServerError,
} from "../../src/igdb/errors.js";

// Basicamernte un HttpClient personalizado que no hace fetch en ningun momento.
// Solo le pasamos un array de respuestas que devolverá en orden y graba las peticiones que le hacemos para poder comprobarlas en los tests.
// Si se queda sin respuestas, lanza un error para avisarnos de que no hemos puesto suficientes respuestas en el array.
class FakeHttpClient implements HttpClient {
  public calls: { url: string; body: string; headers: HeadersInit }[] = [];

  constructor(private responses: HttpResponse[]) {}

  async post(
    url: string,
    body: string,
    headers: HeadersInit,
  ): Promise<HttpResponse> {
    this.calls.push({ url, body, headers });
    const response = this.responses.shift();
    if (!response) {
      throw new Error("FakeHttpClient: no more queued responses");
    }
    return response;
  }
}
// La respuesta del FakeHttpClient.
// La falseamos para que devuelva un status y un json con los datos que queramos
function jsonResponse(status: number, data: unknown = []): HttpResponse {
  return { status, json: async () => data };
}
// Aqui usamos la respuesta jsoqnResponse para devolver un token de prueba. 200ok
function tokenResponse(): HttpResponse {
  return jsonResponse(200, { access_token: "token-abc", expires_in: 7200 });
}
// Aqui usamos la respuesta jsonResponse para devolver un listado de juegos de prueba. 200ok
function gamesResponse(games: unknown[]): HttpResponse {
  return jsonResponse(200, games);
}

// Funcion para crear un cliente de prueba con un FakeHttpClient y un HttpIgdbClient.
// Le pasamos un array de respuestas que el FakeHttpClient devolverá en orden.
// La primera respuesta siempre es un token de prueba recien renovado, y las siguientes son las que queramos para los tests.
function makeClient(responses: HttpResponse[]) {
  const fakeClientHttp = new FakeHttpClient([tokenResponse(), ...responses]);
  const fakeclientIgdb = new HttpIgdbClient(
    fakeClientHttp,
    "my-client-id",
    "my-secret",
  );
  return { fakeClientHttp, fakeclientIgdb };
}

describe("HttpIgdbClient.fetchGames", () => {
  it("builds the IGDB request: URL, headers, fields, limit, offset and sort", async () => {
    const { fakeClientHttp, fakeclientIgdb } = makeClient([gamesResponse([])]);

    //Primer test, testemos la funcion fetchGames con offset y limit, que es la que nos devuelve juegos sin criterio de busqueda.
    await fakeclientIgdb.fetchGames({ offset: 20, limit: 10 });
    // Fingimos una call que nos devolvera la respuesta 1, es decir gamesResponse([])
    // La respuesta 0 es el token de prueba que devuelve tokenResponse()
    const call = fakeClientHttp.calls[1];
    expect(call.url).toBe("https://api.igdb.com/v4/games");
    expect((call.headers as Record<string, string>)["Client-ID"]).toBe(
      "my-client-id",
    );
    expect((call.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer token-abc",
    );
    expect(call.body).toContain("fields ");
    expect(call.body).toContain("genres.name");
    expect(call.body).toContain("cover.image_id");
    expect(call.body).toContain("involved_companies.company.name");
    expect(call.body).toContain("limit 10");
    expect(call.body).toContain("offset 20");
    expect(call.body).toContain("sort name asc");
  });
});

describe("HttpIgdbClient.searchGames", () => {
  it("builds a search query with search term and limit (no offset/sort)", async () => {
    const { fakeClientHttp, fakeclientIgdb } = makeClient([gamesResponse([])]);
    // Testemos la funcion searchGames con un criterio de busqueda y un limite de resultados.
    // Aunque nos devolvera lo mismo que el anterior.
    await fakeclientIgdb.searchGames("elden ring", 5);

    const call = fakeClientHttp.calls[1];
    expect(call.url).toBe("https://api.igdb.com/v4/games");
    expect(call.body).toContain('search "elden ring"');
    expect(call.body).toContain("limit 5");
    expect(call.body).toContain("game_type");
    expect(call.body).toContain("where version_parent = null");
    expect(call.body).not.toContain("offset");
    expect(call.body).not.toContain("sort");
  });

  it("filters out version/port records to keep only the main game", async () => {
    const { fakeClientHttp, fakeclientIgdb } = makeClient([gamesResponse([])]);
    // Spotlight: las versiones/ports (version_parent) no deben aparecer como candidatos.
    await fakeclientIgdb.searchGames("hollow knight", 10);

    const call = fakeClientHttp.calls[1];
    expect(call.body).toContain("where version_parent = null;");
  });

  it("sanitizes characters that would break the IGDB query language", async () => {
    const { fakeClientHttp, fakeclientIgdb } = makeClient([gamesResponse([])]);
    // Testemos la funcion searchGames con un criterio de busqueda que contenga caracteres que puedan romper la query de IGDB.
    await fakeclientIgdb.searchGames('halo"; reach;\n drop');

    const call = fakeClientHttp.calls[1];
    // Sin comillas, sin ';' y sin saltos de línea dentro del término buscado
    expect(call.body).toContain('search "halo reach drop"');
  });
});

describe("HttpIgdbClient error mapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([401, 403])(
    "maps HTTP %i to IgdbAuthError without retrying",
    async (status) => {
      const { fakeClientHttp, fakeclientIgdb } = makeClient([
        jsonResponse(status),
      ]);
      const pending = fakeclientIgdb.fetchGames({ offset: 0, limit: 10 });
      const assertion = expect(pending).rejects.toThrow(IgdbAuthError);
      await vi.runAllTimersAsync();
      await assertion;
      // token + games = 2 peticiones: no hubo reintento
      expect(fakeClientHttp.calls).toHaveLength(2);
    },
  );

  it.each([429, 500])(
    "maps HTTP %i to a retryable error and exhausts retries",
    async (status) => {
      const { fakeClientHttp, fakeclientIgdb } = makeClient([
        jsonResponse(status),
        jsonResponse(status),
        jsonResponse(status),
        jsonResponse(status),
      ]);

      const pending = fakeclientIgdb.fetchGames({ offset: 0, limit: 10 });
      const assertion = expect(pending).rejects.toThrow(
        status === 429 ? IgdbRateLimitError : IgdbServerError,
      );
      await vi.runAllTimersAsync();
      await assertion;

      // token + 4 intentos (1 inicial + 3 reintentos)
      expect(fakeClientHttp.calls).toHaveLength(5);
    },
  );
});

describe("HttpIgdbClient retry policy", () => {
  //esto usa una funcion de vitest que nos permite usar timers falsos.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  //Esta, en cambio, nos devuelve los timers a la normalidad para que no afecte a otros tests.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 429 and succeeds when a later attempt works", async () => {
    // Creamos un cliente de prueba con un FakeHttpClient que devolverá 2 respuestas 429 y luego una respuesta de juegos válida.
    const { fakeClientHttp, fakeclientIgdb } = makeClient([
      jsonResponse(429),
      jsonResponse(429),
      gamesResponse([{ id: 1, name: "Hollow Knight" }]),
    ]);
    // Llamamos a fetchGames y guardamos la promesa pendiente.
    const pending = fakeclientIgdb.fetchGames({ offset: 0, limit: 10 });
    // Ejecutamos todos los timers pendientes para que se resuelvan los reintentos.
    await vi.runAllTimersAsync();
    // Esperamos a que la promesa pendiente se resuelva y obtenemos los juegos devueltos.
    const games = await pending;

    expect(games).toHaveLength(1);
    // token + 3 intentos
    expect(fakeClientHttp.calls).toHaveLength(4);
  });

  it("propagates the error after exhausting all retries (4 total attempts)", async () => {
    // Creamos un error del servidor con 4 reintentos fallidos.
    const { fakeClientHttp, fakeclientIgdb } = makeClient([
      jsonResponse(500),
      jsonResponse(500),
      jsonResponse(500),
      jsonResponse(500),
    ]);

    const pending = fakeclientIgdb.fetchGames({ offset: 0, limit: 10 });
    const assertion = expect(pending).rejects.toThrow(IgdbServerError);
    await vi.runAllTimersAsync();
    await assertion;

    // token + 4 intentos (1 inicial + 3 reintentos)
    expect(fakeClientHttp.calls).toHaveLength(5);
  });
});

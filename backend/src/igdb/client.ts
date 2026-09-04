import type { HttpClient, IgdbClient, IgdbGameRaw } from "./types.js";
import { IgdbAuth } from "./auth.js";
import {
  IgdbAuthError,
  IgdbError,
  IgdbRateLimitError,
  IgdbServerError,
} from "./errors.js";

const IGDB_API_URL = "https://api.igdb.com/v4/games";
const MAX_RETRIES = 4; // 1 initial + 3 retries = 4 total attempts
const BASE_DELAY_MS = 1000;

const FIELDS = [
  "name",
  "summary",
  "first_release_date",
  "game_type",
  "cover.image_id",
  "genres.name",
  "platforms.name",
  "game_modes.name",
  "player_perspectives.name",
  "keywords.name",
  "themes.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
].join(", ");

// Clase que implementa la interfaz IgdbClient y maneja la autenticación y las solicitudes a la API de IGDB
export class HttpIgdbClient implements IgdbClient {
  private auth: IgdbAuth;

  constructor(
    private httpClient: HttpClient,
    clientId: string,
    clientSecret: string,
  ) {
    this.auth = new IgdbAuth(clientId, clientSecret, httpClient);
  }
  //Aqui implementamos los metodos que declaramos en types.ts
  //Este no creo que lo usemos porque devuelve juegos sin criterio.
  async fetchGames(options: {
    offset: number;
    limit: number;
  }): Promise<IgdbGameRaw[]> {
    const token = await this.auth.getAccessToken();
    const body = this.buildQuery(options.offset, options.limit);
    return this.withRetry(() => this.request(token, body));
  }
  // este nos permite buscar juegos con un criterio de búsqueda y un límite de resultados. (el bueno)
  async searchGames(query: string, limit = 10): Promise<IgdbGameRaw[]> {
    const token = await this.auth.getAccessToken();
    // Sanitized limpia la cadena de búsqueda para evitar inyecciones de código y caracteres problemáticos
    // Reemplaza comillas, punto y coma y saltos de línea con espacios.
    // Luego reemplaza múltiples espacios con uno solo y recorta los espacios al inicio y al final
    const sanitized = query
      .replace(/[";\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const body =
      [
        `fields ${FIELDS}`,
        `search "${sanitized}"`,
        // Las versiones/ports (version_parent) son registros independientes en
        // IGDB; filtramos solo el juego principal en resultados de búsqueda.
        "where version_parent = null",
        `limit ${limit}`,
      ].join("; ") + ";";
    return this.withRetry(() => this.request(token, body));
  }
  // Constructor de la query de busqueda.
  private buildQuery(offset: number, limit: number): string {
    return (
      [
        `fields ${FIELDS}`,
        `limit ${limit}`,
        `offset ${offset}`,
        "sort name asc",
      ].join("; ") + ";"
    );
  }
  // Usa el httpclient para hacer la petición a la API
  // Esta es la clave, ya que el httpclient del test le devolvera lo que queramos y el que sale del index.ts hace la petición real a la API de IGDB.
  // Importante para entender la relación entre los tests y el código de producción.
  private async request(token: string, body: string): Promise<IgdbGameRaw[]> {
    const response = await this.httpClient.post(IGDB_API_URL, body, {
      "Client-ID": this.auth["clientId"],
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });

    if (response.status === 429) {
      throw new IgdbRateLimitError();
    }
    if (response.status >= 500) {
      throw new IgdbServerError();
    }
    if (response.status === 401 || response.status === 403) {
      throw new IgdbAuthError();
    }
    if (response.status !== 200) {
      throw new IgdbError(`Unexpected IGDB response: ${response.status}`);
    }

    return (await response.json()) as IgdbGameRaw[];
  }
  // Mecanismo de reintentos si el error lo permite. Es decir IgdbRateLimitError o IgdbServerError.
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRetryable =
          error instanceof IgdbRateLimitError ||
          error instanceof IgdbServerError;
        if (!isRetryable) {
          throw error; // 401/403 or other errors: do not retry
        }
        if (attempt === MAX_RETRIES - 1) {
          throw error; // last attempt: propagate error
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        await this.sleep(delay);
      }
    }
    throw new IgdbError("Retry loop exited unexpectedly");
  }
  // Funcion para esperar entre repeticiones del retry.
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

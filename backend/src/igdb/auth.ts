import type { HttpClient } from "./types.js";
import { IgdbAuthError } from "./errors.js";

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
}

export class IgdbAuth {
  private token: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private httpClient: HttpClient,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token;
    }
    await this.refreshToken();
    return this.token!;
  }
  //Funcion tipica de refresco de token como las que hacemos con el JWT.
  private async refreshToken(): Promise<void> {
    const url = new URL("https://id.twitch.tv/oauth2/token");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("client_secret", this.clientSecret);
    url.searchParams.set("grant_type", "client_credentials");

    // Lo mismo con el httpclient de client.ts
    // En los tests, el httpclient es FakeHttpClient y devuelve lo que queramos.
    // En producción, el httpclient es FetchHttpClient (el de index.ts) y hace la petición real a la API de Twitch.
    const response = await this.httpClient.post(url.toString(), "", {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    // Cualquier respuesta que no sea 200, lanzamos un error de autenticación.
    if (response.status !== 200) {
      throw new IgdbAuthError(
        `Token request failed with status ${response.status}`,
      );
    }
    // Parseamos la respuesta JSON y guardamos el token y la fecha de expiración.
    const data = (await response.json()) as TwitchTokenResponse;
    this.token = data.access_token;
    // Restamos 3600 segundos (1 hora) al tiempo de expiración para refrescar el token antes de que caduque.
    // Esto es una práctica común para evitar que el token caduque mientras se está usando.
    this.expiresAt = Date.now() + (data.expires_in - 3600) * 1000;
  }
}

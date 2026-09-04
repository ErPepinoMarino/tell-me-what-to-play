// Interfaz para lanzar peticiones HTTP a la API de IGDB
// Se abstrae para poder inyectar un cliente falso en los tests
export interface HttpClient {
  post(url: string, body: string, headers: HeadersInit): Promise<HttpResponse>;
}
// Interfaz para la respuesta de la API de IGDB
// Ocurre lo mismo que con HttpClient.
export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}

// Los datos que devuelve la API de IGDB para un juego, viene de su Api, no es cosa nuestra.
export interface IgdbGameRaw {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number; // epoch seconds
  game_type?: number; // id de game_types (0 Main Game ... 14 Update)
  total_rating_count?: number; // nº de valoraciones de usuarios (señal de calidad)
  cover?: { image_id: string };
  genres?: { id: number; name: string }[];
  platforms?: { id: number; name: string }[];
  game_modes?: { id: number; name: string }[];
  player_perspectives?: { id: number; name: string }[];
  keywords?: { id: number; name: string }[];
  themes?: { id: number; name: string }[];
  involved_companies?: {
    id: number;
    company: { id: number; name: string };
    developer: boolean;
    publisher: boolean;
  }[];
}

// Interfaz con las peticiones que le haremos a IGDB
// fetchGames para que nos devuelva un array de juegos que no sabemos (no la usaremos)
// searchGames (la buena) que nos permite añadir una query con criterios de búsqueda y un límite de resultados.
export interface IgdbClient {
  fetchGames(options: {
    offset: number;
    limit: number;
  }): Promise<IgdbGameRaw[]>;

  searchGames(query: string, limit?: number): Promise<IgdbGameRaw[]>;
}

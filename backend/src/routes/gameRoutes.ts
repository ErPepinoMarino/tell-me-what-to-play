import type { FastifyInstance } from "fastify";
import { gameService } from "../services/gameService.js";

const gameSearchSchema = {
  querystring: {
    //Definimos el esquema de validación para la querystring
    type: "object",
    //Nombre del parámetro de búsqueda
    required: ["q"],
    //Tan evidente que no lo voy ni a explicar.
    properties: {
      q: {
        type: "string",
        minLength: 1,
        maxLength: 100,
      },
    },
  },
};
const gameParamsSchema = {
  params: {
    type: "object",
    required: ["slug"],
    properties: {
      slug: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      },
    },
  },
};
type GameQuery = {
  q: string;
};
type GameParams = {
  slug: string;
};
/*
type AddToLibraryRequest = {
  gameId: number;
  favorite: boolean;
};

const addToLibrarySchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["gameId", "favorite"],
    properties: {
      gameId: {
        type: "integer",
        minimum: 1,
      },
      favorite: {
        type: "boolean",
      },
    },
  },
};
*/

//Usamos FastifyInstance para tipar la función gameRoutes
export async function gameRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: GameQuery;
  }>(
    "/api/games",
    {
      schema: gameSearchSchema, //solo con incluir schema en la ruta, Fastify valida y devuelve error 400 o no.
    },
    async (request) => {
      //Hacemos la busqueda usando gameService
      const games = await gameService.search(request.query.q);
      return games;
    },
  );
  //Ruta para obtener un juego específico por su slug
  fastify.get<{ Params: GameParams }>(
    "/api/games/:slug",
    {
      schema: gameParamsSchema,
    },
    async (request) => {
      return gameService.getBySlug(request.params.slug);
    },
  );
  /*
  fastify.post<{
    Body: AddToLibraryRequest;
  }>(
    "/api/library",
    {
      schema: addToLibrarySchema,
    },
    async (request) => {
      return libraryService.add(request.body.gameId, request.body.favorite);
    },
  );
  */
}

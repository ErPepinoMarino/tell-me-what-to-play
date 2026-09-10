import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { getUser } from "../lib/authUser.js";
import { userGamesService } from "../services/userGamesService.js";
import {
  UserNotFoundError,
  GameNotFoundError,
  GameNotInLibraryError,
  GameAlreadyInLibraryError,
} from "../errors/userGamesErrors.js";

const userLibraryParamsSchema = {
  type: "object",
  required: ["targetUserId"],
  additionalProperties: false,
  properties: {
    targetUserId: {
      type: "integer",
      minimum: 1,
    },
  },
};

const userGameParamsSchema = {
  type: "object",
  required: ["targetUserId", "gameId"],
  additionalProperties: false,
  properties: {
    targetUserId: {
      type: "integer",
      minimum: 1,
    },
    gameId: {
      type: "integer",
      minimum: 1,
    },
  },
};

const addGameToLibraryBodySchema = {
  type: "object",
  required: ["gameId"],
  additionalProperties: false,
  properties: {
    gameId: {
      type: "integer",
      minimum: 1,
    },
  },
};

const updateLibraryEntryBodySchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["PENDING", "PLAYED", "COMPLETED"],
    },
    recommendation: {
      type: "string",
      enum: ["HIGHLY_RECOMMENDED", "RECOMMENDED", "MEH", "NOT_RECOMMENDED"],
    },
    review: {
      type: "string",
      minLength: 1,
    },
  },
};

export async function userGamesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { targetUserId: number } }>(
    "/api/users/:targetUserId/library",
    {
      preHandler: authMiddleware,
      schema: {
        params: userLibraryParamsSchema,
      },
    },
    async (request, reply) => {
      try {
        //Sacamos el id del JWT, importante.
        //El id bueno es el que viene en JWT, no el que viene en la URL.
        const user = getUser(request);
        if (user === undefined) {
          return reply.code(401).send({ error: "Invalid or missing token" });
        }
        const actorUserId = Number(user.sub);
        const targetUserId = Number(request.params.targetUserId);

        return await userGamesService.getLibrary(
          actorUserId,
          targetUserId,
        );
      } catch (error) {
        if (
          error instanceof UserNotFoundError ||
          error instanceof GameNotFoundError ||
          error instanceof GameNotInLibraryError
        ) {
          return reply.code(404).send({ message: error.message });
        }

        return reply.code(500).send({ message: "Internal server error" });
      }
    },
  );

  fastify.post<{
    Params: { targetUserId: number };
    Body: { gameId: number };
  }>(
    "/api/users/:targetUserId/library",
    {
      preHandler: authMiddleware,
      schema: {
        params: userLibraryParamsSchema,
        body: addGameToLibraryBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const user = getUser(request);
        if (user === undefined) {
          return reply.code(401).send({ error: "Invalid or missing token" });
        }
        const actorUserId = Number(user.sub);
        const targetUserId = Number(request.params.targetUserId);

        return await userGamesService.addToLibrary(
          actorUserId,
          targetUserId,
          request.body.gameId,
        );
      } catch (error) {
        if (error instanceof GameAlreadyInLibraryError) {
          return reply.code(409).send({ message: error.message });
        }

        if (
          error instanceof UserNotFoundError ||
          error instanceof GameNotFoundError ||
          error instanceof GameNotInLibraryError
        ) {
          return reply.code(404).send({ message: error.message });
        }

        return reply.code(500).send({ message: "Internal server error" });
      }
    },
  );

  fastify.put<{
    Params: { targetUserId: number; gameId: number };
    Body: {
      status?: "PENDING" | "PLAYED" | "COMPLETED";
      recommendation?:
        "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "MEH" | "NOT_RECOMMENDED";
      review?: string;
    };
  }>(
    "/api/users/:targetUserId/library/:gameId",
    {
      preHandler: authMiddleware,
      schema: {
        params: userGameParamsSchema,
        body: updateLibraryEntryBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const user = getUser(request);
        if (user === undefined) {
          return reply.code(401).send({ error: "Invalid or missing token" });
        }
        const actorUserId = Number(user.sub);
        const targetUserId = Number(request.params.targetUserId);
        const gameId = Number(request.params.gameId);

        return await userGamesService.updateLibraryEntry(
          actorUserId,
          targetUserId,
          gameId,
          request.body,
        );
      } catch (error) {
        if (
          error instanceof UserNotFoundError ||
          error instanceof GameNotFoundError ||
          error instanceof GameNotInLibraryError
        ) {
          return reply.code(404).send({ message: error.message });
        }

        return reply.code(500).send({ message: "Internal server error" });
      }
    },
  );

  fastify.delete<{ Params: { targetUserId: number; gameId: number } }>(
    "/api/users/:targetUserId/library/:gameId",
    {
      preHandler: authMiddleware,
      schema: {
        params: userGameParamsSchema,
      },
    },
    async (request, reply) => {
      try {
        const user = getUser(request);
        if (user === undefined) {
          return reply.code(401).send({ error: "Invalid or missing token" });
        }
        const actorUserId = Number(user.sub);
        const targetUserId = Number(request.params.targetUserId);
        const gameId = Number(request.params.gameId);

        return await userGamesService.removeFromLibrary(
          actorUserId,
          targetUserId,
          gameId,
        );
      } catch (error) {
        if (
          error instanceof UserNotFoundError ||
          error instanceof GameNotFoundError ||
          error instanceof GameNotInLibraryError
        ) {
          return reply.code(404).send({ message: error.message });
        }

        return reply.code(500).send({ message: "Internal server error" });
      }
    },
  );
}

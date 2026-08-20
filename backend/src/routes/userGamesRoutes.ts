import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { prisma } from "../lib/prisma.js";
import { userGamesService } from "../services/userGamesService.js";

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
  const getActorRole = async (userId: number) => {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new Error("not found");
    }

    return user.role;
  };

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
        const actorUserId = Number(request.user.sub);
        const actorRole = await getActorRole(actorUserId);
        const targetUserId = Number(request.params.targetUserId);

        return await userGamesService.getLibrary(
          actorUserId,
          actorRole,
          targetUserId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";

        if (
          message === "not found" ||
          message === "game not found" ||
          message === "game not in library"
        ) {
          return reply.code(404).send({ message });
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
        const actorUserId = Number(request.user.sub);
        const actorRole = await getActorRole(actorUserId);
        const targetUserId = Number(request.params.targetUserId);

        return await userGamesService.addToLibrary(
          actorUserId,
          actorRole,
          targetUserId,
          request.body.gameId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";

        if (
          message === "not found" ||
          message === "game not found" ||
          message === "game not in library"
        ) {
          return reply.code(404).send({ message });
        }

        if (message === "game already in library") {
          return reply.code(409).send({ message });
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
        const actorUserId = Number(request.user.sub);
        const actorRole = await getActorRole(actorUserId);
        const targetUserId = Number(request.params.targetUserId);
        const gameId = Number(request.params.gameId);

        return await userGamesService.updateLibraryEntry(
          actorUserId,
          actorRole,
          targetUserId,
          gameId,
          request.body,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";

        if (
          message === "not found" ||
          message === "game not found" ||
          message === "game not in library"
        ) {
          return reply.code(404).send({ message });
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
        const actorUserId = Number(request.user.sub);
        const actorRole = await getActorRole(actorUserId);
        const targetUserId = Number(request.params.targetUserId);
        const gameId = Number(request.params.gameId);

        return await userGamesService.removeFromLibrary(
          actorUserId,
          actorRole,
          targetUserId,
          gameId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";

        if (
          message === "not found" ||
          message === "game not found" ||
          message === "game not in library"
        ) {
          return reply.code(404).send({ message });
        }

        return reply.code(500).send({ message: "Internal server error" });
      }
    },
  );
}

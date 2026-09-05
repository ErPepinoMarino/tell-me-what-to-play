import type { FastifyInstance } from "fastify";
import { optionalAuthMiddleware } from "../middlewares/optionalAuthMiddleware.js";
import type { RecommendationAction } from "../types/Recommendation.js";
import { GameSearchIntentSchema } from "../types/GameSearchIntent.js";
import {
  InterpretationError,
  LoginRequiredError,
  SessionExpiredError,
} from "../orchestrator/errors.js";
import { getRecommendationOrchestrator } from "../orchestrator/index.js";

const recommendationBodySchema = {
  type: "object",
  required: ["message"],
  additionalProperties: false,
  properties: {
    message: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
    action: {
      type: "string",
      enum: ["search", "more"],
    },
    // Última intención del cliente: permite clasificar refine-vs-new para anon
    contextIntent: {
      type: ["object", "null"],
      additionalProperties: true,
    },
  },
};

interface RecommendationBody {
  message: string;
  action?: RecommendationAction;
  contextIntent?: unknown;
}

export async function recommendationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post<{ Body: RecommendationBody }>(
    "/api/recommendations",
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        body: recommendationBodySchema,
      },
    },
    async (request, reply) => {
      const action = request.body.action ?? "search";
      // El actor viene del JWT cuando existe; sin cabecera es anónimo.
      const authSub = (request as { user?: { sub: string } }).user?.sub;
      const actor = authSub
        ? ({ kind: "user", userId: Number(authSub) } as const)
        : ({ kind: "anon" } as const);

      let orchestrator;
      try {
        orchestrator = getRecommendationOrchestrator();
      } catch {
        return reply
          .code(503)
          .send({ message: "Recommendation engine is not configured" });
      }

      try {
        // El contextIntent llega del cliente: se VALIDA contra el schema
        // (JSON arbitrario nunca entra como intención).
        const parsedContext = request.body.contextIntent
          ? GameSearchIntentSchema.safeParse(request.body.contextIntent)
          : null;
        const outcome = await orchestrator.handle({
          action,
          message: request.body.message,
          actor,
          contextIntent:
            parsedContext && parsedContext.success
              ? parsedContext.data
              : undefined,
        });

        // Trabajo orgánico post-respuesta: no bloquea ni hace fallar el request.
        void outcome.background;

        return outcome.response;
      } catch (error) {
        if (error instanceof LoginRequiredError) {
          return reply
            .code(401)
            .send({
              message: "Login required for this action",
              notice: "LOGIN_REQUIRED",
            });
        }
        if (error instanceof SessionExpiredError) {
          return reply
            .code(400)
            .send({
              message: "No active search session",
              notice: "SESSION_EXPIRED",
            });
        }
        if (error instanceof InterpretationError) {
          return reply
            .code(502)
            .send({
              message: "Intent interpretation is unavailable right now",
            });
        }
        throw error;
      }
    },
  );
}

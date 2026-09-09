import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import { optionalAuthMiddleware } from "../middlewares/optionalAuthMiddleware.js";
import type { RecommendationAction } from "../types/Recommendation.js";
import { GameSearchIntentSchema } from "../types/GameSearchIntent.js";
import {
  InterpretationError,
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
    /*
     * IDs ya mostrados por el cliente (dueño del contexto): se excluyen en
     * los turnos "more"-like. Podría ser manipulado; no es frontera de
     * seguridad (solo afecta a los resultados del propio usuario).
     */
    shownGameIds: {
      type: "array",
      items: { type: "integer" },
      maxItems: 500,
    },
  },
};

interface RecommendationBody {
  message: string;
  action?: RecommendationAction;
  contextIntent?: unknown;
  shownGameIds?: number[];
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
          shownGameIds: request.body.shownGameIds,
        });

        // Trabajo orgánico post-respuesta: no bloquea ni hace fallar el request.
        void outcome.background;

        return outcome.response;
      } catch (error) {
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

/*
 * POST /api/recommendations/stream: mismo contrato de entrada y misma
 * orquestación que /api/recommendations, pero responde SSE por trozos
 * (intent → snapshots rankeados por tanda → done). Misma semántica de
 * errores, entregada como evento cuando las cabeceras ya volaron.
 */
export async function recommendationStreamRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post<{ Body: RecommendationBody }>(
    "/api/recommendations/stream",
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        body: recommendationBodySchema,
      },
    },
    async (request, reply) => {
      const action = request.body.action ?? "search";
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

      const parsedContext = request.body.contextIntent
        ? GameSearchIntentSchema.safeParse(request.body.contextIntent)
        : null;

      // El stream se envía en cuanto se crea: errores posteriores viajan
      // como evento, con el mismo código/mensaje/aviso que el endpoint
      // clásico (el frontend reutiliza su tabla de fallos).
      const stream = new PassThrough();
      reply.header("content-type", "text/event-stream");
      reply.header("cache-control", "no-cache, no-transform");
      reply.header("connection", "keep-alive");
      // Anti-buffer para proxies intermedios (Next rewrite, nginx): sin
      // esto algunos retienen el stream hasta el final y todo llega en bloque.
      reply.header("X-Accel-Buffering", "no");
      reply.send(stream);

      const send = (event: unknown): void => {
        stream.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      // Latido anti-timeout para respuestas largas (cada tanda enriquece).
      const heartbeat = setInterval(() => {
        stream.write(":ping\n\n");
      }, 10_000);

      try {
        const outcome = await orchestrator.handle(
          {
            action,
            message: request.body.message,
            actor,
            contextIntent:
              parsedContext && parsedContext.success
                ? parsedContext.data
                : undefined,
            shownGameIds: request.body.shownGameIds,
          },
          (event) => send({ ...event }),
        );
        send({ event: "done", response: outcome.response });
        void outcome.background;
      } catch (error) {
        if (error instanceof InterpretationError) {
          send({
            event: "error",
            status: 502,
            message: "Intent interpretation is unavailable right now",
          });
        } else {
          send({ event: "error", status: 500 });
        }
      } finally {
        clearInterval(heartbeat);
        stream.end();
      }
    },
  );
}

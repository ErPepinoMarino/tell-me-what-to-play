import type { FastifyRequest, FastifyReply } from "fastify";

export async function loggerMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  console.log(`${request.method} ${request.url}`);
}

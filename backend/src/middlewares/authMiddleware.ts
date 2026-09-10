import { FastifyReply, FastifyRequest } from "fastify";

/*
 * Gestión de entrada: informa al backend quién llega.
 * - Sin cabecera Authorization → anónimo
 * - Token válido → usuario
 * - Token inválido/caducado → 401, para que el cliente decida
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.headers.authorization === undefined) {
    return;
  }

  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({
      error: "Invalid or expired token",
    });
  }
}

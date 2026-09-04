import { FastifyReply, FastifyRequest } from "fastify";

/*
 * Autenticación opcional para rutas que atienden anónimos y usuarios.
 * - Sin cabecera Authorization → anónimo, continúa sin request.user.
 * - Cabecera presente pero token inválido/expirado → 401: degradar
 *   silenciosamente a anónimo haría parecer un usuario nuevo.
 */
export async function optionalAuthMiddleware(
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

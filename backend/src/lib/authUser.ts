import { FastifyRequest } from "fastify";

export interface AuthUser {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/*
 * Accesor tipado de la identidad que resolvió authMiddleware. @fastify/jwt
 * tipa request.user como siempre presente, pero solo existe cuando llegó un
 * token válido. Centralizar el cast aquí evita repetirlo en cada handler.
 */
export function getUser(request: FastifyRequest): AuthUser | undefined {
  const user = (request as FastifyRequest & { user?: AuthUser | null }).user;

  return user ?? undefined;
}

export function getUserIdOrNull(request: FastifyRequest): number | null {
  const user = getUser(request);

  return user === undefined ? null : Number(user.sub);
}

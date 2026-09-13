import { createHash } from "node:crypto";

/*
 * TTL único de la sesión y del refresh token (24 h): se aplica a la
 * expiración de la sesión en la BD y al maxAge de la cookie web.
 * REFRESH_SESSION_TTL_SECONDS se deriva de la única fuente de verdad.
 */
export const REFRESH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_SESSION_TTL_SECONDS = REFRESH_SESSION_TTL_MS / 1000;

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

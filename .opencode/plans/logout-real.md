# Plan: logout real (revocar sesión + limpiar cookie) + pendientes aprobados

## 1. Backend — endpoint de logout (`authRoutes.ts` + `authService.ts`)
- `POST /api/auth/logout`, mismo transporte dual que refresh (cookie httpOnly
  para web; body { refreshToken } para nativos):
  - Lee el token (cookie primero, body después).
  - Si existe: `authService.logoutSession(token)`:
    - hash SHA-256 → `findRefreshToken` (incluye la sesión).
    - Si encontrado: `revokeSession(session.id)` (invalida TODOS sus refresh
      tokens — `rotateRefreshToken` ya trata `session_revoked` → refresh
      posterior devuelve null) + `revokeRefreshToken(tokenId)` (cinturón).
  - Siempre: `clearCookie("refresh_token", { path: "/api/auth" })`.
  - Respuesta 204. Idempotente (logout sin token/no encontrado → igual 204).

## 2. Frontend (`auth.tsx` + `Login.tsx`)
- `logout()` pasa a ASYNC y llama `POST /api/auth/logout` antes de limpiar
  memoria. Best-effort: si la llamada falla, limpia memoria igual (pero la
  cookie httpOnly no se puede borrar desde JS; el usuario deberá reintentar).
- `Login.tsx`: `void logout()`.

## 3. Tests
- e2e (authRefresh): login → logout → refresh devuelve 401 (sesión revocada);
  logout sin token → 204 y no rompe.
- Unit authService: logoutSession revoca sesión + token.

## Pendientes aprobados (ya planificados, se ejecutan en la misma ronda)
- Anon refine → CTA de login (LLM relation + contextIntent).
- Guardia determinista de años (regex ES/EN).
- Trace completo del intent (yearFrom/yearTo/excluded).

## Verificación
1. tsc + smoke + lint + builds.
2. Usuario: rebuild docker + re-test: login → logout → F5 → sigue sin sesión;
   y la batería conversacional (anon refine → CTA; logueado merge con año).
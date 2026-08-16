import { FastifyInstance } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { prismaSessionRepository } from "../repositories/prismaSessionRepository.js";
import { prismaUserRepository } from "../repositories/prismaUserRepository.js";

export function createAuthService(
  app: FastifyInstance,
  sessionRepository: typeof prismaSessionRepository,
  userRepository: typeof prismaUserRepository,
) {
  // Importante declarar esta variable fuera de las funciones
  // para que no se cree una instancia cada vez que se llame.
  const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  return {
    createAccessToken(userId: number) {
      return app.jwt.sign({
        sub: String(userId),
        iss: "tellmewhattoplay-api",
        aud: "tellmewhattoplay-client",
      });
    },
    async createSession(userId: number) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      return sessionRepository.create(userId, expiresAt);
    },
    createRefreshToken() {
      const token = randomBytes(32).toString("base64url");

      const tokenHash = createHash("sha256").update(token).digest("hex");

      return {
        token,
        tokenHash,
      };
    },
    async createAuthSession(userId: number) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const existingSession = await sessionRepository.getByUserId(userId);

      const session = existingSession
        ? await sessionRepository.updateSession(existingSession.id, expiresAt)
        : await sessionRepository.create(userId, expiresAt);

      //si existe una sesion revocamos los refresh tokens. ojo
      if (existingSession) {
        await sessionRepository.revokeRefreshTokens(existingSession.id);
      }

      const { token: refreshToken, tokenHash } = this.createRefreshToken();

      await sessionRepository.saveRefreshToken(session.id, tokenHash);

      const accessToken = this.createAccessToken(userId);

      return {
        accessToken,
        refreshToken,
      };
    },
    async validateRefreshToken(token: string) {
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const refreshToken = await sessionRepository.findRefreshToken(tokenHash);

      if (!refreshToken) {
        return null;
      }

      return refreshToken;
    },
    isSessionExpired(expiresAt: Date) {
      return Date.now() >= expiresAt.getTime();
    },
    async refreshSession(token: string) {
      const refreshToken = await this.validateRefreshToken(token);

      if (!refreshToken) {
        return null;
      }

      // Un refresh token ya utilizado no puede volver a utilizarse.
      if (refreshToken.revoked_at) {
        await sessionRepository.revokeSession(refreshToken.session_id);
        return null;
      }

      // La sesión ha caducado.
      if (this.isSessionExpired(refreshToken.sessions.expires_at)) {
        await sessionRepository.revokeSession(refreshToken.session_id);
        return null;
      }

      // El refresh token sigue vigente.
      if (!this.isRefreshTokenExpired(refreshToken.created_at)) {
        const accessToken = this.createAccessToken(
          refreshToken.sessions.user_id,
        );

        return {
          accessToken,
          refreshToken: token,
        };
      }

      // El refresh token ha caducado.
      // Se rota y se prolonga la sesión 24 horas.
      await sessionRepository.revokeRefreshToken(refreshToken.id);

      const newRefreshToken = this.createRefreshToken();

      await sessionRepository.saveRefreshToken(
        refreshToken.session_id,
        newRefreshToken.tokenHash,
      );

      const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await sessionRepository.updateExpiresAt(
        refreshToken.session_id,
        newExpiresAt,
      );

      const accessToken = this.createAccessToken(refreshToken.sessions.user_id);

      return {
        accessToken,
        refreshToken: newRefreshToken.token,
      };
    },
    isRefreshTokenExpired(createdAt: Date) {
      return Date.now() >= createdAt.getTime() + 60 * 60 * 1000;
    },
    async exchangeGoogleCode(code: string) {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        const error = await response.text();

        throw new Error(
          `Google token exchange failed: ${response.status} ${error}`,
        );
      }

      return response.json();
    },
    async verifyGoogleIdentity(idToken: string) {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.sub || !payload.email) {
        throw new Error(
          "Google ID token does not contain the required identity",
        );
      }

      return {
        sub: payload.sub,
        email: payload.email,
      };
    },
    async authenticateUser(identity: { sub: string; email: string }) {
      const user = await userRepository.findByIdentity("google", identity.sub);

      if (user) {
        return this.createAuthSession(user.id);
      }

      const newUser = await userRepository.create(
        identity.email,
        "google",
        identity.sub,
      );

      return this.createAuthSession(newUser.id);
    },
  };
}

import type { FastifyInstance } from "fastify";
import { createAuthService } from "../services/authService.js";
import { prismaSessionRepository } from "../repositories/prismaSessionRepository.js";
import { prismaUserRepository } from "../repositories/prismaUserRepository.js";
import crypto from "node:crypto";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const authService = createAuthService(
    fastify,
    prismaSessionRepository,
    prismaUserRepository,
  );

  fastify.post("/api/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies.refresh_token;

    if (!refreshToken) {
      return reply.code(401).send({
        message: "No hay refresh token",
      });
    }

    const result = await authService.refreshSession(refreshToken);

    if (!result) {
      return reply.code(401).send({
        message: "No se pudo renovar la sesión",
      });
    }

    reply.setCookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      secure: false, // true cuando usemos HTTPS
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 60 * 60,
    });

    return {
      accessToken: result.accessToken,
    };
  });

  fastify.get("/api/auth/google", async (request, reply) => {
    const state = crypto.randomUUID();

    reply.setCookie("oauth_state", state, {
      httpOnly: true,
      secure: false, // true cuando usemos HTTPS
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      response_type: "code",
      scope: "openid email profile",
      state,
    });

    return reply.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  });

  const googleCallbackSchema = {
    querystring: {
      type: "object",
      required: ["code", "state"],
      additionalProperties: false,
      properties: {
        code: {
          type: "string",
          minLength: 1,
        },
        state: {
          type: "string",
          minLength: 1,
        },
      },
    },
  };

  fastify.get<{
    Querystring: {
      code: string;
      state: string;
    };
  }>(
    "/api/auth/google/callback",
    {
      schema: googleCallbackSchema,
    },
    async (request, reply) => {
      const { code, state } = request.query;

      const storedState = request.cookies.oauth_state;

      if (!storedState || storedState !== state) {
        return reply.code(401).send({
          message: "Estado OAuth inválido",
        });
      }

      reply.clearCookie("oauth_state", {
        path: "/",
      });

      try {
        const googleTokens = await authService.exchangeGoogleCode(code);

        if (!googleTokens.id_token) {
          throw new Error("Google response does not contain an ID token");
        }

        const identity = await authService.verifyGoogleIdentity(
          googleTokens.id_token,
        );

        const result = await authService.authenticateUser(identity);

        reply.setCookie("refresh_token", result.refreshToken, {
          httpOnly: true,
          secure: false, // true con HTTPS
          sameSite: "lax",
          path: "/api/auth",
          maxAge: 60 * 60,
        });

        return {
          accessToken: result.accessToken,
        };
      } catch (error) {
        console.error("GOOGLE AUTH ERROR:", error);

        return reply.code(401).send({
          message: "No se pudo autenticar con Google",
        });
      }
    },
  );
}

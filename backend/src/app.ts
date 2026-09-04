//Fastify
import fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";

//Esto es para usar el secreto de JWT desde el archivo .env
import "dotenv/config";

//rutas
import { healthRoutes } from "./routes/healthRoutes.js";
import { gameRoutes } from "./routes/gameRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userGamesRoutes } from "./routes/userGamesRoutes.js";
import { recommendationRoutes } from "./routes/recommendationRoutes.js";

/*
 * Construcción de la app separada del listen: los e2e pueden levantar la
 * misma app in-process (con mocks de IA/APIs) mientras el server real
 * mantiene su punto de entrada intacto.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify();

  //registro el plugin de JWT con el secreto de JWT desde el archivo .env
  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: {
      expiresIn: "15m",
    },
  });

  //Rutas
  app.register(fastifyCookie);
  app.register(authRoutes);
  app.register(healthRoutes);
  app.register(gameRoutes);
  app.register(userGamesRoutes);
  app.register(recommendationRoutes);

  await app.ready();

  return app;
}

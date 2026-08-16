//Fastify
import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";

//Esto es para usar el secreto de JWT desde el archivo .env
import "dotenv/config";

//rutas
import { healthRoutes } from "./routes/healthRoutes.js";
import { gameRoutes } from "./routes/gameRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userGamesRoutes } from "./routes/userGamesRoutes.js";

//servicios
import { createAuthService } from "./services/authService.js";
import { prismaSessionRepository } from "./repositories/prismaSessionRepository.js";
import { prismaUserRepository } from "./repositories/prismaUserRepository.js";

//middlewares
import { loggerMiddleware } from "./middlewares/loggerMiddleware.js";
import { authMiddleware } from "./middlewares/authMiddleware.js";

const app = fastify();

//registro el plugin de JWT con el secreto de JWT desde el archivo .env
app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET!,
  sign: {
    expiresIn: "15m",
  },
});

app.get("/test-auth-session", async () => {
  const authService = createAuthService(
    app,
    prismaSessionRepository,
    prismaUserRepository,
  );

  return authService.createAuthSession(1);
});

app.get(
  "/test-protected",
  {
    preHandler: authMiddleware,
  },
  async (request) => {
    return {
      message: "Acceso autorizado",
      userId: request.user.sub,
    };
  },
);

//middleWare
app.addHook("onRequest", loggerMiddleware);

//Rutas
app.register(fastifyCookie);
app.register(authRoutes);
app.register(healthRoutes);
app.register(gameRoutes);
app.register(userGamesRoutes);

//Completado registro de middleware y rutas - Levanto el servidor en el puerto 3001 y muestro la dirección en consola. (para no compartir puerto con el frontend)
try {
  const address = await app.listen({ port: 3001 });
  console.log(address);
} catch (err) {
  console.error(err);
  process.exit(1);
}

import fastify from "fastify";
import { healthRoutes } from "./routes/healthRoutes.js";
import { gameRoutes } from "./routes/gameRoutes.js";
import { loggerMiddleware } from "./middlewares/loggerMiddleware.js";

const app = fastify();

//middleWare
app.addHook("onRequest", loggerMiddleware);

//Rutas
app.register(healthRoutes);
app.register(gameRoutes);

//Completado registro de middleware y rutas - Levanto el servidor en el puerto 3001 y muestro la dirección en consola. (para no compartir puerto con el frontend)
try {
  const address = await app.listen({ port: 3001 });
  console.log(address);
} catch (err) {
  console.error(err);
  process.exit(1);
}

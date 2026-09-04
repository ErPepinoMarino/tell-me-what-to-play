import { buildApp } from "./app.js";
import { prismaCatalogLayer } from "./orchestrator/adapters.js";
import { ensureSeedCatalog } from "./services/seedCatalogService.js";

// Bootstrap del catálogo popular: garantiza el baseline del seed en PG en
// cualquier entorno (compose, Railway). Idempotente (skip de existentes) y
// best-effort: si la BDD no responde, el server arranca igual y las rutas
// degradan con sus notices como siempre.
try {
  const bootstrap = await ensureSeedCatalog(prismaCatalogLayer);
  console.log(
    `[bootstrap] catálogo seed: ${bootstrap.created} creadas, ${bootstrap.skipped} ya existentes.`,
  );
} catch (error) {
  console.error("[bootstrap] no se pudo sembrar el catálogo seed:", error);
}

const app = await buildApp();

//Completado registro de middleware y rutas - Levanto el servidor en el puerto 3001 y muestro la dirección en consola. (para no compartir puerto con el frontend)
try {
  //El host: 0,0,0,0 es porque sino al hacer el compose de Docker no funcionaba, de nada.
  const address = await app.listen({
    host: "0.0.0.0",
    port: 3001,
  });
  console.log(address);
} catch (err) {
  console.error(err);
  process.exit(1);
}

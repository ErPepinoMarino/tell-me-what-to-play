import { buildApp } from "./app.js";

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

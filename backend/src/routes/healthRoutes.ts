import { FastifyInstance } from "fastify";

//Usamos FastifyInstance para tipar la función healthRoutes
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/health", async () => {
    return { status: "Backend funcionando" };
  });
}

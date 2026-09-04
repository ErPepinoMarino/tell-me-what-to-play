import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/services/authService.js";
import { prismaSessionRepository } from "../../src/repositories/prismaSessionRepository.js";
import { prismaUserRepository } from "../../src/repositories/prismaUserRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

// Los mocks van ANTES de los imports de app (Vitest los hoistea).
// El e2e corre in-process: así se prueban ruta, middleware, sesión, orquestador
// y matcher con la BD real, sustituyendo solo la IA y las APIs externas.
vi.mock("../../src/lib/ai.js", () => ({
  gameIntentAIModel: () => ({
    invoke: async () => ({
      gameReferenced: null,
      objective: {
        genres: ["RPG"],
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
      keywords: ["pirates"],
      semantic: null,
    }),
  }),
}));

vi.mock("../../src/lib/explanationAi.js", () => ({
  gameExplanationAIModel: () => ({
    invoke: async () => ({ content: "Explicación e2e de la respuesta." }),
  }),
}));

vi.mock("../../src/igdb/index.js", () => ({
  createIgdbClient: () => ({
    fetchGames: async () => [],
    searchGames: async () => [],
  }),
}));

vi.mock("../../src/services/braveResearchProvider.js", () => ({
  BraveResearchProvider: class {
    async searchEvidence() {
      return [{ source: "e2e", snippet: "pirate adventure evidence" }];
    }
  },
}));

async function seedPiratesGame() {
  return prisma.games.create({
    data: {
      slug: "pirates-cove",
      title: "Pirates Cove",
      genres: ["RPG"],
      keywords: ["pirates"],
      difficulty: 0.5,
      violence: 0.4,
    },
  });
}

async function createUserAndToken(email = "rec@example.com") {
  const user = await prisma.users.create({ data: { email } });

  const tokenApp = fastify();
  await tokenApp.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: "15m" },
  });
  await tokenApp.ready();
  const authService = createAuthService(
    tokenApp,
    prismaSessionRepository,
    prismaUserRepository,
  );
  const session = await authService.createAuthSession(user.id);
  await tokenApp.close();

  return { userId: user.id, accessToken: session.accessToken };
}

describe("POST /api/recommendations E2E", () => {
  // SUPER IMPORTANTE.
  // Awaited crea un tipo que representa el valor resuelto de una promesa.
  // Aqui estamos creando una app fastify distinta a la de server.ts
  // para poder levantarla in-process y testearla sin levantar un server real.
  // TIP: in-process significa que el test corre en el mismo proceso que la app, sin necesidad de levantar un server real y hacer requests HTTP reales.
  // Esto permite testear la app de manera más rápida y controlada, usando mocks para las dependencias externas como IA y APIs.
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "e2e-brave-key");
    app = await buildApp();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app.close();
    await prisma.$disconnect();
  });

  it("búsqueda anónima devuelve recomendaciones con el contrato completo", async () => {
    await seedPiratesGame();

    const response = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].game.slug).toBe("pirates-cove");
    expect(body.results[0].tier).toBe("valid");
    expect(body.results[0].score).toBeGreaterThan(0);
    expect(Array.isArray(body.results[0].reasons)).toBe(true);
    // Las reasons traen block y kind para los chips de la UI
    expect(body.results[0].reasons[0]).toMatchObject({
      block: expect.any(String),
      kind: expect.any(String),
      note: expect.any(String),
    });
    expect(body.explanation).toBe("Explicación e2e de la respuesta.");
    expect(body.requestedGames).toEqual([]);
    expect(body.intent.keywords).toEqual(["pirates"]);
    expect(body.meta.action).toBe("search");
    expect(body.meta.partial).toBe(true);
    expect(body.meta.tierCounts.valid).toBeGreaterThanOrEqual(1);
    expect(body.notices).toContain("PARTIAL_RESULTS");
  });

  it("more anónimo exige login", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "dame más", action: "more" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().notice).toBe("LOGIN_REQUIRED");
  });

  it("usuario autenticado: search guarda sesión y more excluye los mostrados", async () => {
    await seedPiratesGame();
    const { accessToken } = await createUserAndToken();

    const search = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().results).toHaveLength(1);

    const more = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "dame más", action: "more" },
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(more.statusCode).toBe(200);
    const body = more.json();
    expect(body.results).toHaveLength(0);
    expect(body.meta.action).toBe("more");
    expect(body.meta.exhaustedPool).toBe(true);
    expect(body.notices).toContain("SEARCH_EXHAUSTED");
  });

  it("token presente pero inválido devuelve 401 en lugar de degradar a anónimo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
      headers: { authorization: "Bearer not-a-real-jwt" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("valida el cuerpo de la petición", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const empty = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "" },
    });
    expect(empty.statusCode).toBe(400);

    const badAction = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "hola", action: "explode" },
    });
    expect(badAction.statusCode).toBe(400);
  });
});

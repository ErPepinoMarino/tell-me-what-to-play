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

// Estado compartido con el mock (vi.hoisted: disponible dentro de la factory).
// La cola permite simular intents "vacíos" en mensajes de seguimiento;
// sin cola, el mock devuelve la intención por defecto (piratas RPG).
const intentMock = vi.hoisted(() => {
  const DEFAULT_INTENT = {
    gameReferenced: null,
    objective: {
      genres: ["ROLE_PLAYING_RPG"],
      themes: null,
      platforms: null,
      gameModes: null,
      perspectives: null,
    },
    keywords: ["pirates"],
    releaseYear: null,
    yearFrom: null,
    yearTo: null,
    excluded: null,
    semantic: null,
  };
  return { DEFAULT_INTENT, queue: [] as Record<string, unknown>[] };
});

// Los mocks van ANTES de los imports de app (Vitest los hoistea).
// El e2e corre in-process: así se prueban ruta, middleware, sesión, orquestador
// y matcher con la BD real, sustituyendo solo la IA y las APIs externas.
vi.mock("../../src/lib/ai.js", () => ({
  gameIntentAIModel: () => ({
    invoke: async () => intentMock.queue.shift() ?? intentMock.DEFAULT_INTENT,
  }),
  gameRelationAIModel: () => ({
    invoke: async () => ({ relation: "new" }),
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
    filteredSearch: async () => [],
    fetchAllKeywords: async () => [],
    fetchThemesByGameIds: async () => [],
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
      genres: ["ROLE_PLAYING_RPG"],
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
    // Diccionario mínimo en la BD de test: el canonicalize del orquestador
    // (léxico real) necesita entradas o DROP todos los keywords del intent.
    await prisma.keyword_lexicon.createMany({
      data: [
        { canonical: "pirates", aliases: [], embedding: [1], source: "igdb" },
      ],
      skipDuplicates: true,
    });
    app = await buildApp();
  });

  beforeEach(async () => {
    intentMock.queue.length = 0;
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
    // El score solo refleja semántica: sin dims comparables es 0 (y no importa)
    expect(body.results[0].score).toBeGreaterThanOrEqual(0);
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

  it("more anónimo con contexto: ya NO exige login", async () => {
    await seedPiratesGame();

    const search = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
    });
    expect(search.statusCode).toBe(200);

    const more = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: {
        message: "dame más",
        action: "more",
        contextIntent: search.json().intent,
        shownGameIds: search.json().results.map(
          (item: { game: { id: string } }) => item.game.id,
        ),
      },
    });

    expect(more.statusCode).toBe(200);
    const body = more.json();
    expect(body.results).toHaveLength(0);
    expect(body.meta.action).toBe("more");
    expect(body.meta.lifecycle).toBe("continue");
    expect(body.notices).not.toContain("REFINE_REQUIRES_LOGIN");
  });

  it("usuario autenticado: more excluye los mostrados del contexto del cliente", async () => {
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
      payload: {
        message: "dame más",
        action: "more",
        contextIntent: search.json().intent,
        shownGameIds: search.json().results.map(
          (item: { game: { id: string } }) => item.game.id,
        ),
      },
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(more.statusCode).toBe(200);
    const body = more.json();
    expect(body.results).toHaveLength(0);
    expect(body.meta.action).toBe("more");
    expect(body.meta.lifecycle).toBe("continue");
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

  it("mensaje sin intención nueva reutiliza la intención previa de sesión (INTENT_UNCHANGED)", async () => {
    await seedPiratesGame();
    const { accessToken } = await createUserAndToken();

    const first = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(first.statusCode).toBe(200);

    // El "LLM" devuelve un objective vacío pero presente (mensaje tipo "sí")
    intentMock.queue.push({
      gameReferenced: null,
      objective: {
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
      keywords: null,
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      semantic: null,
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: {
        message: "si que quiero",
        contextIntent: first.json().intent,
      },
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.notices).toContain("INTENT_UNCHANGED");
    expect(body.intent.keywords).toEqual(["pirates"]);
    // Sin exclusión en search: los mostrados re-compiten y vuelven
    expect(body.results).toHaveLength(1);
    expect(body.results[0].game.slug).toBe("pirates-cove");
  });

  it("search sin exclusión: repetir la búsqueda vuelve a mostrar los mejores", async () => {
    await seedPiratesGame();
    const { accessToken } = await createUserAndToken();

    const payload = {
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "quiero un juego de piratas" },
      headers: { authorization: `Bearer ${accessToken}` },
    } as const;

    const first = await app.inject(payload);
    const second = await app.inject(payload);

    expect(first.json().results).toHaveLength(1);
    expect(second.json().results).toHaveLength(1);
    expect(second.json().results[0].game.slug).toBe("pirates-cove");
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

    // Acciones del contrato antiguo retiradas: afinar/cambiar de tema es
    // decisión del LLM, no del cliente
    const legacyRefine = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "menos violento", action: "refine" },
    });
    expect(legacyRefine.statusCode).toBe(400);

    const legacyPivot = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { message: "otro tema", action: "pivot" },
    });
    expect(legacyPivot.statusCode).toBe(400);
  });
});

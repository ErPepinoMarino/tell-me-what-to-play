import { spawn, type ChildProcess } from "node:child_process";
import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthService } from "../../src/services/authService.js";
import { prismaSessionRepository } from "../../src/repositories/prismaSessionRepository.js";
import { prismaUserRepository } from "../../src/repositories/prismaUserRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

const baseUrl = "http://127.0.0.1:3001";
let serverProcess: ChildProcess;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Backend server did not start within 10 seconds");
}

async function createAuthSession(userId: number) {
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
  const session = await authService.createAuthSession(userId);

  await tokenApp.close();
  return session;
}

async function createUser(email = "refresh@example.com") {
  return prisma.users.create({ data: { email } });
}

async function refreshRequest(refreshToken: string) {
  return fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { cookie: `refresh_token=${refreshToken}` },
  });
}

describe("POST /api/auth/refresh E2E", () => {
  beforeAll(async () => {
    serverProcess = spawn(
      process.execPath,
      ["--import", "tsx/esm", "src/server.ts"],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "ignore",
      },
    );

    await waitForServer();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    serverProcess.kill();
    await prisma.$disconnect();
  });

  it("returns 401 when the refresh cookie is missing", async () => {
    //Lanzamos una peticion POST a /api/auth/refresh sin la cookie de refresh token y esperamos un 401.
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No hay refresh token" });
  });

  it("returns 401 for an unknown refresh token", async () => {
    //Tratamos usar un refresh cookie que no existe.
    const response = await refreshRequest("token-that-does-not-exist");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo renovar la sesión" });
  });

  it("returns a new access token for a valid refresh token", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);

    // Tratamos re renovar el JWT con un refresh token valido.
    // Esto deberia ser un 200 Ok.
    const response = await refreshRequest(session.refreshToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.accessToken).not.toBe("");
    expect(response.headers.get("set-cookie")).toContain("refresh_token=");
  });

  it("returns 401 and revokes the session when the refresh token is revoked", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });

    await prisma.refresh_tokens.update({
      //Creamos un refresh token revocado.
      where: {
        token_hash: (await prisma.refresh_tokens.findFirst())!.token_hash,
      },
      data: { revoked_at: new Date() },
    });

    // Tratamos re renovar el JWT con un refresh token que ha sido revocado.
    const response = await refreshRequest(session.refreshToken);
    const body = await response.json();
    const revokedSession = await prisma.sessions.findUnique({
      where: { id: persistedSession!.id },
    });

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo renovar la sesión" });
    expect(revokedSession?.revoked_at).toBeInstanceOf(Date);
  });

  it("returns 401 and revokes the refresh tokens when the session is revoked", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });

    await prisma.sessions.update({
      where: { id: persistedSession!.id },
      data: { revoked_at: new Date() },
    });

    // Tratamos re renovar el JWT con un refresh token que pertenece a una sesion revocada.
    // La sesion tiene prioridad sobre el refresh token, asi que la sesion revocada invalida todos sus refresh tokens.
    const response = await refreshRequest(session.refreshToken);
    const body = await response.json();
    const revokedToken = await prisma.refresh_tokens.findFirst();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo renovar la sesión" });
    expect(revokedToken?.revoked_at).toBeInstanceOf(Date);
  });

  it("returns 401 and revokes the session when the session is expired", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });

    await prisma.sessions.update({
      where: { id: persistedSession!.id },
      data: { expires_at: new Date("2000-01-01T00:00:00.000Z") },
    });

    // Tratamos re renovar el JWT con un refresh token que pertenece a una sesion expirada.
    // De nuevo, la sesion prevalece.
    const response = await refreshRequest(session.refreshToken);
    const body = await response.json();
    const expiredSession = await prisma.sessions.findUnique({
      where: { id: persistedSession!.id },
    });

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo renovar la sesión" });
    expect(expiredSession?.revoked_at).toBeInstanceOf(Date);
  });

  it("rotates an expired refresh token and returns new tokens", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const oldToken = await prisma.refresh_tokens.findFirst();

    await prisma.refresh_tokens.update({
      where: { id: oldToken!.id },
      data: { created_at: new Date("2000-01-01T00:00:00.000Z") },
    });

    // Tratamos re renovar el JWT con un refresh token que ha caducado pero el refresh token sigue vigente.
    // Esto deberia rotar el refresh token y devolver un nuevo access token y refresh token.
    const response = await refreshRequest(session.refreshToken);
    const body = await response.json();
    const refreshCookie = response.headers.get("set-cookie");
    const tokens = await prisma.refresh_tokens.findMany({
      orderBy: { id: "asc" },
    });

    expect(response.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie).toContain("refresh_token=");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.revoked_at).toBeInstanceOf(Date);
    expect(tokens[1]?.revoked_at).toBeNull();
  });

  it("rejects a rotated refresh token when it is replayed", async () => {
    //Largo pero sencillo:
    //Vamos a probar un refresh token que ha sido rotado y que se intenta usar de nuevo.
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const oldToken = await prisma.refresh_tokens.findFirst();
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });
    //Forzamos que el refresh token caduque.
    await prisma.refresh_tokens.update({
      where: { id: oldToken!.id },
      data: { created_at: new Date("2000-01-01T00:00:00.000Z") },
    });
    //Tratamos de conseguir un nuevo access token
    const rotationResponse = await refreshRequest(session.refreshToken);
    const rotationCookie = rotationResponse.headers.get("set-cookie");
    const newRefreshToken = rotationCookie!.match(/refresh_token=([^;]+)/)?.[1];
    const newTokenResponse = await refreshRequest(newRefreshToken!);
    const replayResponse = await refreshRequest(session.refreshToken);
    //usamos replayResponse para intentar usar el refresh token viejo que ya fue rotado.
    const replayBody = await replayResponse.json();
    const revokedSession = await prisma.sessions.findUnique({
      where: { id: persistedSession!.id },
    });
    //Como el refresh token viejo ya fue rotado, la sesion deberia ser revocada y el refresh token viejo tambien.
    //Esperamos que se cree el nuevo refresh token,
    //que el nuevo access token sea valido
    //y que el replay del refresh token viejo falle con un 401.
    expect(rotationResponse.status).toBe(200);
    expect(newRefreshToken).toEqual(expect.any(String));
    expect(newTokenResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
    expect(replayBody).toEqual({
      message: "No se pudo renovar la sesión",
    });
    expect(revokedSession?.revoked_at).toBeInstanceOf(Date);
  });

  it("consumes a refresh token only once under concurrent requests", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);
    const refreshRow = await prisma.refresh_tokens.findFirstOrThrow();
    let releaseRowLock!: () => void;
    const rowLockRelease = new Promise<void>((resolve) => {
      releaseRowLock = resolve;
    });
    let rowLockReady!: () => void;
    const rowLockAcquired = new Promise<void>((resolve) => {
      rowLockReady = resolve;
    });
    const rowLockTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM refresh_tokens
        WHERE id = ${refreshRow.id}
        FOR UPDATE
      `;
      rowLockReady();
      await rowLockRelease;
    });

    await rowLockAcquired;
    const responsePromises = [
      refreshRequest(session.refreshToken),
      refreshRequest(session.refreshToken),
    ];
    await Promise.race(
      responsePromises.map((response) => response.then(() => undefined)),
    );
    releaseRowLock();

    const responses = await Promise.all(responsePromises);
    await rowLockTransaction;
    const results = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get("set-cookie"),
      })),
    );
    const tokens = await prisma.refresh_tokens.findMany({
      orderBy: { id: "asc" },
    });
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 401)).toHaveLength(1);
    expect(results.filter((result) => Boolean(result.cookie))).toHaveLength(1);
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.revoked_at)).toHaveLength(1);
    expect(tokens.filter((token) => !token.revoked_at)).toHaveLength(1);
    expect(persistedSession?.revoked_at).toBeNull();
  });

  it("renews with a valid refresh token independently of an old access token", async () => {
    const user = await createUser();
    const session = await createAuthSession(user.id);

    // Peticion para renovar el refresh token con un access token viejo o expirado. Esto deberia ser un 200 OK tmb.
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: `refresh_token=${session.refreshToken}`,
        authorization: "Bearer old-or-expired-access-token",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
  });

  it("allows refreshing with the newest session token", async () => {
    const user = await createUser();
    await createAuthSession(user.id);
    const secondSession = await createAuthSession(user.id);

    // Creamos una segunda sesion con un refresh token nuevo.
    // El de la sesion anterior queda invalidado pero el actual es 200 ok.
    const newResponse = await refreshRequest(secondSession.refreshToken);
    const body = await newResponse.json();

    expect(newResponse.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(newResponse.headers.get("set-cookie")).toContain("refresh_token=");
  });

  it("rejects the previous refresh token after a new session is created", async () => {
    const user = await createUser();
    const firstSession = await createAuthSession(user.id);
    await createAuthSession(user.id);

    // El caso anterior pero tratando de usar el refresh token de la sesion anterior.
    // Como el nuevo lo invalida esto deberia ser un 401 y revocar el refresh token.
    // Deberia, además cerrar la sesion.
    const previousToken = await prisma.refresh_tokens.findFirst({
      orderBy: { id: "asc" },
    });
    const oldResponse = await refreshRequest(firstSession.refreshToken);
    const body = await oldResponse.json();
    const persistedToken = await prisma.refresh_tokens.findUnique({
      where: { id: previousToken!.id },
    });
    const persistedSession = await prisma.sessions.findUnique({
      where: { user_id: user.id },
    });

    expect(oldResponse.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo renovar la sesión" });
    expect(persistedToken?.revoked_at).toBeInstanceOf(Date);
    expect(persistedSession?.revoked_at).toBeInstanceOf(Date);
  });
});

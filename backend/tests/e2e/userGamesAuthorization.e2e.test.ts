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
//Creamos el JWT para las peticiones.
async function createAccessToken(userId: number): Promise<string> {
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
  return session.accessToken;
}

async function createValidTokenForSubject(subject: number): Promise<string> {
  const tokenApp = fastify();

  await tokenApp.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: "15m" },
  });
  await tokenApp.ready();

  const accessToken = tokenApp.jwt.sign({
    sub: String(subject),
    iss: "tellmewhattoplay-api",
    aud: "tellmewhattoplay-client",
  });

  await tokenApp.close();
  return accessToken;
}
//Arrancamos server.
describe("user library authorization E2E", () => {
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

  it("returns 404 when a user tries to update another user's game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha@example.com" },
    });
    const vicente = await prisma.users.create({
      data: { email: "vicente@example.com" },
    });
    const gameB = await prisma.games.create({
      data: {
        slug: "game-b",
        title: "Game B",
        genres: ["Adventure"],
        platforms: ["PC"],
      },
    });

    await prisma.user_games.create({
      data: {
        user_id: vicente.id,
        game_id: gameB.id,
        status: "PENDING",
      },
    });

    const conchaAccessToken = await createAccessToken(concha.id);
    //Concha entra y trata de actualizar el juego de Vicente, que no es suyo. Esto no se permite.
    //Importante el 404 y no el 403, SEGURIDAD.
    //El primer campo del fetch es la url que apunta a vicente, pero la peticion la hace Concha
    //El segundo campo del fetch es el objeto de configuracion, donde se indica el metodo PUT, la cabecera con el JWT de Concha y el body con los datos a actualizar.
    const otherUserResponse = await fetch(
      `${baseUrl}/api/users/${vicente.id}/library/${gameB.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${conchaAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED" }),
      },
    );
    const persistedGameB = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: vicente.id, game_id: gameB.id },
      },
    });

    expect(otherUserResponse.status).toBe(404);
    expect(persistedGameB?.status).toBe("PENDING");
  });

  it("returns 200 when a user updates their own game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha@example.com" },
    });
    const gameA = await prisma.games.create({
      data: {
        slug: "game-a",
        title: "Game A",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: {
        user_id: concha.id,
        game_id: gameA.id,
        status: "PENDING",
      },
    });
    //Sin más, esta es Concha tratando de actualizar su propio juego. 200 OK.
    const conchaAccessToken = await createAccessToken(concha.id);
    const ownGameResponse = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${gameA.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${conchaAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "COMPLETED",
          review: "Completed by Concha",
        }),
      },
    );
    const persistedGameA = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: gameA.id },
      },
    });

    expect(ownGameResponse.status).toBe(200);
    expect(persistedGameA).toMatchObject({
      status: "COMPLETED",
      review: "Completed by Concha",
    });
  });

  it("returns 401 when no JWT is provided", async () => {
    // En esta peticion no se envia JWT, por lo que el servidor devuelve 401 Unauthorized.
    // Si te fijas estamos usarndo users/1/ porque ni siquiera hace falta que exista el usuario 1,
    // ya que la peticion ni siquiera llega a comprobarlo. El error es de autenticacion, no de autorizacion.
    const response = await fetch(`${baseUrl}/api/users/1/library/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: "Invalid or missing token",
    });
  });

  it("returns 401 when the JWT is invalid", async () => {
    //En esta peticion se envia un JWT llamado "token-falso".
    //¿Resultado? Que el token es falso. Esperable.
    const response = await fetch(`${baseUrl}/api/users/1/library/1`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer token-falso",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: "Invalid or missing token",
    });
  });

  it("returns 404 when a valid JWT subject does not exist in the database", async () => {
    const accessToken = await createValidTokenForSubject(123);

    //En esta peticion se envia un JWT valido, pero el usuario del JWT no existe en la base de datos.
    //lo sabemos porque la bdd está vacía. Por lo que no existe ni 123 ni ninguno.
    const response = await fetch(`${baseUrl}/api/users/123/library`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: "not found" });
  });

  it("adds a game to the authenticated user's library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-post@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-post",
        title: "Game POST",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de añadir un juego a su propia biblioteca. Esto se permite.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: game.id }),
    });
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry).toMatchObject({
      user_id: concha.id,
      game_id: game.id,
      status: "PENDING",
    });
  });

  it("returns 401 when adding a game without a JWT", async () => {
    //Se trata de añadir un juego pero sin JWT. 401 Unauthorized.
    const response = await fetch(`${baseUrl}/api/users/1/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: 1 }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when adding a game to another user's library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-foreign@example.com" },
    });
    const vicente = await prisma.users.create({
      data: { email: "vicente-foreign@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-foreign",
        title: "Game Foreign",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de añadir un juego a la biblioteca de Vicente. Esto no se permite.
    //Similar, aunque no igual, a la prueba de actualizar un juego de otro usuario.
    const response = await fetch(`${baseUrl}/api/users/${vicente.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: game.id }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when adding a nonexistent game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-missing-game@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de añadir un juego que no existe a su propia biblioteca. 404 Not Found.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: 999999 }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 409 when adding a game already in the library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-duplicate@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-duplicate",
        title: "Game Duplicate",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: {
        user_id: concha.id,
        game_id: game.id,
        status: "PENDING",
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de añadir un juego que ya tiene en su biblioteca.
    // No admitimos duplicados. 409 Conflict.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: game.id }),
    });
    const entries = await prisma.user_games.findMany({
      where: { user_id: concha.id, game_id: game.id },
    });

    expect(response.status).toBe(409);
    expect(entries).toHaveLength(1);
  });

  it("returns 400 when the add-library body is invalid", async () => {
    const concha = await prisma.users.create({
      //Body invalido, no tiene gameId. 400 Bad Request.
      data: { email: "concha-invalid-body@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de añadir un juego a su propia biblioteca
    //En este caso el body de la peticion es invalido. 400 Bad Request.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 when updating a nonexistent game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-update-missing-game@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de actualizar un juego que no existe.
    //Si el juego no existe no puede estar en la biblioteca. 404 Not Found.
    //Ya teniamos el de actualizar un juego de otro usuario, este aun no.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/999999`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when updating a game that is not in the library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-update-missing-entry@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-update-missing-entry",
        title: "Game Update Missing Entry",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de actualizar un juego que no tiene en su propia biblioteca.
    //En este caso el juego podria existir, pero no esta en la biblioteca de Concha.
    //404 Not Found.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when deleting a nonexistent game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-delete-missing-game@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de eliminar un juego que no existe de su propia biblioteca. 404 Not Found.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/999999`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    expect(response.status).toBe(404);
  });

  it("deletes a game from the user's library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-delete@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-delete",
        title: "Game Delete",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha trata de eliminar un juego de su propia biblioteca. 200ok.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry).toBeNull();
  });

  it("returns 401 when deleting without a JWT", async () => {
    //Se trata de eliminar un juego pero sin JWT. 401 Unauthorized.
    //Ademas se coreta rapido ya que users/1/ no pasa ni de la autenticacion.
    const response = await fetch(`${baseUrl}/api/users/1/library/1`, {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when deleting another user's game", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-delete-foreign@example.com" },
    });
    const vicente = await prisma.users.create({
      data: { email: "vicente-delete-foreign@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-delete-foreign",
        title: "Game Delete Foreign",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: vicente.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha trata de eliminar un juego de la biblioteca de Vicente. Esto no se permite. 404 Not Found.
    //Importante el 404 y no el 403, SEGURIDAD. Lo repito pa que no se olvide.
    const response = await fetch(
      `${baseUrl}/api/users/${vicente.id}/library/${game.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when deleting a nonexistent library entry", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-delete-missing@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-delete-missing",
        title: "Game Delete Missing",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha trata de eliminar un juego que no tiene en su biblioteca. 404 Not Found.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns the authenticated user's library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-get@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-get",
        title: "Game Get",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de consultar su propia biblioteca. 200 OK.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([expect.objectContaining({ game_id: game.id })]);
  });

  it("returns 404 when querying another user's library", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-get-foreign@example.com" },
    });
    const vicente = await prisma.users.create({
      data: { email: "vicente-get-foreign@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de consultar la biblioteca de Vicente. Esto no se permite. 404 (como antes)
    const response = await fetch(`${baseUrl}/api/users/${vicente.id}/library`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the target user does not exist", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-get-missing@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha entra y trata de consultar la biblioteca de un usuario que no existe. 404 Not Found.
    //En este caso 404 es no es por seguridad, sino porque el usuario no existe.
    const response = await fetch(`${baseUrl}/api/users/999999/library`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.status).toBe(404);
  });

  it("allows an ADMIN to query another user's library", async () => {
    const admin = await prisma.users.create({
      data: { email: "admin-get@example.com", role: "ADMIN" },
    });
    const concha = await prisma.users.create({
      data: { email: "concha-admin-get@example.com" },
    });
    const accessToken = await createAccessToken(admin.id);

    //Aqui quien entra es un ADMIN, la cosa cambia.
    //ADMIN puede consultar la biblioteca de otro usuario. 200 OK.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns 401 when querying a library without a JWT", async () => {
    //Facil, aqui no hay JWT. 401 Unauthorized.
    //Mismo sistema que antes, users/1/ no pasa ni de la autenticacion.
    const response = await fetch(`${baseUrl}/api/users/1/library`);

    expect(response.status).toBe(401);
  });

  it("allows an ADMIN to add a game to another user's library", async () => {
    const admin = await prisma.users.create({
      data: { email: "admin-post@example.com", role: "ADMIN" },
    });
    const concha = await prisma.users.create({
      data: { email: "concha-admin-post@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-admin-post",
        title: "Game Admin POST",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(admin.id);

    //el Admin trata de añadir un juego a la biblioteca de Concha. 200 OK.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: game.id }),
    });
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry).toMatchObject({
      user_id: concha.id,
      game_id: game.id,
      status: "PENDING",
    });
  });

  it("allows an ADMIN to update another user's library entry", async () => {
    const admin = await prisma.users.create({
      data: { email: "admin-put@example.com", role: "ADMIN" },
    });
    const concha = await prisma.users.create({
      data: { email: "concha-admin-put@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-admin-put",
        title: "Game Admin PUT",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(admin.id);

    //El Admin trata de actualizar un juego de la biblioteca de Concha. 200 OK.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED" }),
      },
    );
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry?.status).toBe("COMPLETED");
  });

  it("allows an ADMIN to delete another user's library entry", async () => {
    const admin = await prisma.users.create({
      data: { email: "admin-delete@example.com", role: "ADMIN" },
    });
    const concha = await prisma.users.create({
      data: { email: "concha-admin-delete@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-admin-delete",
        title: "Game Admin DELETE",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(admin.id);

    //El Admin trata de eliminar un juego de la biblioteca de Concha. 200 OK.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry).toBeNull();
  });

  it("coerces a numeric POST gameId string", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-post-invalid-type@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-post-coerced",
        title: "Game POST Coerced",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Fastify/Ajv convierte el string numerico al entero definido por el schema.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: String(game.id) }),
    });
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry?.game_id).toBe(game.id);
  });

  it("ignores an unexpected POST body property", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-post-extra@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-post-extra",
        title: "Game POST Extra",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Fastify/Ajv elimina propiedades no declaradas porque additionalProperties es false.
    const response = await fetch(`${baseUrl}/api/users/${concha.id}/library`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId: game.id, unexpected: true }),
    });
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry?.game_id).toBe(game.id);
  });

  it("returns 400 when PUT body is empty", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-put-empty@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Si se trata de actualizar un juego en la biblioteca de Concha pero el body esta vacio, 400 Bad Request.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/1`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when PUT status is invalid", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-put-invalid-status@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Si se trata de actualizar un juego en la biblioteca de Concha pero el status es invalido, 400 Bad Request.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/1`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "INVALID" }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("ignores an unexpected PUT body property", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-put-extra@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-put-extra",
        title: "Game PUT Extra",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Fastify/Ajv elimina propiedades no declaradas porque additionalProperties es false.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED", unexpected: true }),
      },
    );
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry?.status).toBe("COMPLETED");
  });

  it("returns 400 when a library parameter is invalid", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-invalid-param@example.com" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Si se trata de eliminar un juego de la biblioteca de Concha pero el parametro de la ruta no es un entero, 400 Bad Request.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/not-an-integer`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    expect(response.status).toBe(400);
  });

  it("creates exactly one library entry under concurrent POST requests", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-concurrent-post@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-concurrent-post",
        title: "Game Concurrent POST",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    const accessToken = await createAccessToken(concha.id);

    //Dos peticiones simultaneas con el mismo usuario y el mismo gameId.
    //La entrada no existe inicialmente. La DB debe ser la autoridad de integridad
    //y detectar el duplicado via la clave unica (user_id, game_id).
    const responsePromises = [
      fetch(`${baseUrl}/api/users/${concha.id}/library`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId: game.id }),
      }),
      fetch(`${baseUrl}/api/users/${concha.id}/library`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId: game.id }),
      }),
    ];

    const responses = await Promise.all(responsePromises);
    const statuses = responses.map((response) => response.status).sort();
    const entries = await prisma.user_games.findMany({
      where: { user_id: concha.id, game_id: game.id },
    });

    //No asumimos que request gana: exactamente una 200 y una 409.
    expect(statuses).toEqual([200, 409]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("PENDING");

    // Una segunda operación normal sobre la entrada persistida debe seguir funcionando.
    const updateResponse = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED" }),
      },
    );
    const persistedAfterUpdate = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(updateResponse.status).toBe(200);
    expect(persistedAfterUpdate?.status).toBe("COMPLETED");
  });

  it("persists the recommendation when updating a library entry", async () => {
    const concha = await prisma.users.create({
      data: { email: "concha-recommendation@example.com" },
    });
    const game = await prisma.games.create({
      data: {
        slug: "game-recommendation",
        title: "Game Recommendation",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });
    await prisma.user_games.create({
      data: { user_id: concha.id, game_id: game.id, status: "PENDING" },
    });
    const accessToken = await createAccessToken(concha.id);

    //Concha actualiza su entrada con recommendation y verificamos que se persiste
    //a traves de la frontera real: HTTP -> route -> validation -> service -> repository -> PostgreSQL.
    const response = await fetch(
      `${baseUrl}/api/users/${concha.id}/library/${game.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "PLAYED",
          recommendation: "HIGHLY_RECOMMENDED",
        }),
      },
    );
    const persistedEntry = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: concha.id, game_id: game.id },
      },
    });

    expect(response.status).toBe(200);
    expect(persistedEntry).toMatchObject({
      status: "PLAYED",
      recommendation: "HIGHLY_RECOMMENDED",
    });
  });
});

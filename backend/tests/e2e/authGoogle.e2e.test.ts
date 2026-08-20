import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("GET /api/auth/google E2E", () => {
  beforeAll(async () => {
    serverProcess = spawn(
      process.execPath,
      [
        "--import",
        "tsx/esm",
        "--import",
        "./tests/e2e/googleProviderMock.ts",
        "src/server.ts",
      ],
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

  afterAll(() => {
    serverProcess.kill();
  });

  it("redirects to Google and stores the OAuth state in a cookie", async () => {
    // Llamamos al endpoint de inicio de OAuth y verificamos
    // que redirige a Google y establece la cookie de estado OAuth.
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = response.headers.get("location");
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(302);
    expect(location).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
    expect(new URL(location!).searchParams.get("response_type")).toBe("code");
    expect(new URL(location!).searchParams.get("scope")).toBe(
      "openid email profile",
    );

    const state = new URL(location!).searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toMatch(new RegExp(`oauth_state=${state}`));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  it("returns 401 when the OAuth state is invalid", async () => {
    //Llamo al backend con un state invalido. Obvio, porque se llama invalid-state. duh!
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=test-code&state=invalid-state`,
      {
        headers: { cookie: "oauth_state=stored-state" },
      },
    );
    const body = await response.json();
    //inmediatamente el backend devuelve 401
    // ya que invalid-state != el chorro de 36 caracteres generado.
    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "Estado OAuth inválido" });
  });

  it("returns 401 when Google rejects the authorization code", async () => {
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");
    const oauthCookie = setCookie!.split(";")[0];
    // Este tambien falla, pero en nuestro mockup googleProviderMock
    // Ya que estamos especificando code = google-error.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=google-error&state=${state}`,
      {
        headers: { cookie: oauthCookie },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "No se pudo autenticar con Google" });
  });

  it("completes OAuth and creates the local user session", async () => {
    //Montamos una llamada correcta, con un code valido y el state correcto.
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");
    const oauthCookie = setCookie!.split(";")[0];
    // Como la llamada es correcta el mockup devuelve lo esperado
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=valid-code&state=${state}`,
      {
        headers: { cookie: oauthCookie },
      },
    );
    const body = await response.json();
    const users = await prisma.users.findMany({
      include: {
        identities: true,
        session: { include: { refresh_tokens: true } },
      },
    });
    const refreshCookie = response.headers.get("set-cookie");

    //Hemos recibido un OAuthClient mockeado
    //Falso pero que coincide con el contrato de la API.
    //Así que para el backend todo ha ido bien.

    expect(response.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.accessToken).not.toBe("");
    expect(refreshCookie).toContain("refresh_token=");
    expect(refreshCookie).toContain("HttpOnly");
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("oauth-test@example.com");
    expect(users[0]?.identities).toHaveLength(1);
    expect(users[0]?.identities[0]?.provider).toBe("google");
    expect(users[0]?.identities[0]?.provider_sub).toBe("google-test-sub");
    expect(users[0]?.session).not.toBeNull();
    expect(users[0]?.session?.refresh_tokens).toHaveLength(1);
    expect(response.headers.get("set-cookie")).toContain("oauth_state=;");
  });

  it("reuses an existing user for the same Google identity", async () => {
    const user = await prisma.users.create({
      data: {
        email: "oauth-test@example.com",
        identities: {
          create: {
            provider: "google",
            provider_sub: "google-test-sub",
          },
        },
      },
    });
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");

    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=valid-code&state=${state}`,
      {
        headers: { cookie: setCookie!.split(";")[0] },
      },
    );
    const users = await prisma.users.findMany({
      include: { identities: true, session: true },
    });

    expect(response.status).toBe(200);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(user.id);
    expect(users[0]?.identities).toHaveLength(1);
    expect(users[0]?.session).not.toBeNull();
  });

  it("returns 401 when Google does not return an id_token", async () => {
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");

    // En este caso el mockup de Google devuelve un access_token pero no un id_token.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=without-id-token&state=${state}`,
      {
        headers: { cookie: setCookie!.split(";")[0] },
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 when the Google payload has no sub", async () => {
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");

    //Aqui recibimos un id_token sin el campo sub.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=without-sub&state=${state}`,
      {
        headers: { cookie: setCookie!.split(";")[0] },
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 when the Google payload has no email", async () => {
    const startResponse = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = startResponse.headers.get("location");
    const setCookie = startResponse.headers.get("set-cookie");
    const state = new URL(location!).searchParams.get("state");

    //Aqui recibimos un id_token sin el campo email.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=without-email&state=${state}`,
      {
        headers: { cookie: setCookie!.split(";")[0] },
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when the Google callback code is missing", async () => {
    //Peticion al backend con un state correcto pero sin code. Fallo obvio.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?state=some-state`,
      {
        headers: { cookie: "oauth_state=some-state" },
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when the Google callback state is missing", async () => {
    //Peticion al backend con un code correcto pero sin state. Fallo obvio x2.
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=some-code`,
      {
        headers: { cookie: "oauth_state=some-state" },
      },
    );

    expect(response.status).toBe(400);
  });
});

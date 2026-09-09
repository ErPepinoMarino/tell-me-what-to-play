import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

/*
 * Helper compartido de los e2e black-box:
 *  1. elige un PUERTO LIBRE (delegamos al SO: listen(0) y lo leemos);
 *  2. lanza el server REAL (src/server.ts vía tsx) con PORT env = ese puerto;
 *  3. espera a que /api/health responda 200;
 *  4. devuelve baseUrl + stop para matar el proceso.
 *
 * Con esto cada e2e se vuelve autocontenido: ya no choca con el puerto fijo
 * 3001 del backend Docker (arriba o abajo da igual). Se comparte entre
 * health, gameRoutes, authGoogle, authRefresh y userGamesAuthorization para
 * no duplicar el bloque de spawn/wait.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(
  baseUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

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

  throw new Error(`Backend server did not start within ${timeoutMs} ms`);
}

export interface TestServer {
  baseUrl: string;
  stop: () => void;
}

export interface StartTestServerOptions {
  /*
   * Imports extra que se cargan antes de src/server.ts (p. ej. un mock de la
   * provider de Google para los e2e de auth). Cada uno se pasa como --import.
   */
  extraImports?: string[];
}

export async function startTestServer(
  options: StartTestServerOptions = {},
): Promise<TestServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const args = ["--import", "tsx/esm"];
  for (const imp of options.extraImports ?? []) {
    args.push("--import", imp);
  }
  args.push("src/server.ts");

  const serverProcess: ChildProcess = spawn(
    process.execPath,
    args,
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    },
  );

  await waitForServer(baseUrl);

  return {
    baseUrl,
    stop: () => serverProcess.kill(),
  };
}

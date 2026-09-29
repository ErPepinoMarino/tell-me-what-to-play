import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

/*
 * Helper e2e black-box: puerto LIBRE (listen(0)), server REAL (src/server.ts vía
 * tsx), espera 200 en /api/health y devuelve baseUrl + stop. Cada e2e queda
 * autocontenido (olvidaos del 3001 fijo del backend Docker) y comparte el spawn.
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

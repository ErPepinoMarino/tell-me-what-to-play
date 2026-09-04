import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El repo raíz tiene su propio package-lock (monorepo del curso):
  // fijamos la raíz de Turbopack a esta app para silenciar el warning.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.igdb.com",
      },
    ],
  },
  /*
   * Proxy mismo-origen para el navegador: cookies httpOnly funcionan y no
   * hay CORS que configurar. Es una comodidad del cliente WEB: Fastify
   * sigue siendo una API pública e independiente que Android/iOS consumen
   * directamente con Authorization: Bearer.
   */
  async rewrites() {
    const backend = process.env.API_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

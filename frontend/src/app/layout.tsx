import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tell Me What To Play",
  description:
    "Encuentra videojuegos adaptados a tus gustos mediante recomendaciones inteligentes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

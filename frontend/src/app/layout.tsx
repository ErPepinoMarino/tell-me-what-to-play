import type { Metadata } from "next";
import { Orbitron } from "next/font/google";
import "./globals.css";

// Typografía futurística para el hero de frases del chat vacío.
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-orbitron",
  display: "swap",
});

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
    <html lang="es" className={orbitron.variable}>
      <body>
        <div className="bg-decor" aria-hidden="true">
          <div className="bg-glow">
            <span className="bg-circle bg-circle-1" />
            <span className="bg-circle bg-circle-2" />
            <span className="bg-circle bg-circle-3" />
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import type { RecommendedGame, RecommendationMeta } from "@/types/Recommendation";

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

/*
 * Los juegos que el usuario pidió explícitamente (anclas): sirven de
 * referencia para buscar similares, nunca se mezclan con los
 * descubrimientos. El copy de producto llega por notice en el chat.
 */
export function RequestedGamesRow({ games }: { games: RecommendedGame[] }) {
  if (games.length === 0) return null;

  return (
    <div className="requested-row">
      <h3>Lo que pediste (referencia)</h3>
      <div className="requested-cards">
        {games.map((game) => (
          <Link
            key={game.id}
            href={`/?game=${encodeURIComponent(game.slug)}`}
            className="requested-card"
          >
            <Image
              src={game.coverUrl || PLACEHOLDER}
              alt={game.title}
              width={90}
              height={135}
            />
            <span>{game.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/*
 * Panel técnico del modo demo: métricas del orquestador para demostrar
 * el sistema (matching determinista, descubrimiento presupuestado...).
 */
export function DemoMetaPanel({ meta }: { meta: RecommendationMeta }) {
  return (
    <div className="demo-panel demo-meta">
      <p>
        <strong>meta:</strong> acción {meta.action} · {meta.evaluatedCandidates}{" "}
        candidatos evaluados · {meta.discoveryUnitsUsed} unidades de
        descubrimiento
      </p>
      <p>
        <strong>tiers:</strong> {meta.tierCounts.excellent} excelentes ·{" "}
        {meta.tierCounts.valid} válidos · {meta.tierCounts.weak} débiles ·{" "}
        {meta.tierCounts.invalid} inválidos
      </p>
      <p>
        <strong>estado:</strong> {meta.partial ? "lista parcial" : "lista completa"} ·{" "}
        {meta.exhaustedPool ? "pool agotado" : "quedan más resultados"}
      </p>
    </div>
  );
}

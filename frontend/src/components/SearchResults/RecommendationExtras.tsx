"use client";

import Image from "next/image";
import type { RecommendedGame, RecommendationMeta } from "@/types/Recommendation";

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

/*
 * Los juegos que el usuario pidió explícitamente (anclas): sirven de
 * referencia para buscar similares, nunca se mezclan con los
 * descubrimientos. El copy de producto llega por notice en el chat.
 */
export function RequestedGamesRow({
  games,
  onSelectGame,
}: {
  games: RecommendedGame[];
  onSelectGame: (game: RecommendedGame) => void;
}) {
  if (games.length === 0) return null;

  return (
    <div className="requested-row">
      <h3>Lo que pediste (referencia)</h3>
      <div className="flex flex-wrap gap-3">
        {games.map((game) => (
          <button
            key={game.id}
            type="button"
            className="flex flex-col items-center gap-[0.3rem] rounded-lg border border-dashed border-[#555] p-2 text-[0.8rem] text-[#d1d5db]"
            onClick={() => onSelectGame(game)}
          >
            <Image
              src={game.coverUrl || PLACEHOLDER}
              alt={game.title}
              width={90}
              height={135}
            />
            <span>{game.title}</span>
          </button>
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
    <div className="rounded-[10px] border border-dashed border-[#444] px-4 py-3 [font-family:ui-monospace,monospace] text-[0.78rem] text-[#a1a1aa]">
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

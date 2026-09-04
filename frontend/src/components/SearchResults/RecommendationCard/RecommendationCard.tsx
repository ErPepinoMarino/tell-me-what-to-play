"use client";

import Image from "next/image";
import Link from "next/link";
import type { RecommendationResultItem } from "@/types/Recommendation";
import { reasonsToChips, TIER_LABELS } from "@/lib/reasons";

type RecommendationCardProps = {
  item: RecommendationResultItem;
  demoMode: boolean;
};

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

/*
 * Mini ficha explicativa: el objetivo del producto es demostrar que las
 * recomendaciones no son "juegos que un LLM ha sugerido". Los chips vienen
 * del matching determinista (block+kind+note); en modo demo se abre el
 * detalle técnico (score, tier, coverage y contributions).
 */
export default function RecommendationCard({
  item,
  demoMode,
}: RecommendationCardProps) {
  const { game, score, tier, coverage, reasons } = item;
  const chips = reasonsToChips(reasons);
  const description = game.description_es || game.description_en || null;

  return (
    <article className={`game-card tier-${tier}`}>
      <Link href={`/?game=${encodeURIComponent(game.slug)}`} className="game-card-link">
        <div className="game-card-media">
          <Image
            src={game.coverUrl || PLACEHOLDER}
            alt={game.title}
            width={150}
            height={225}
          />
        </div>
        <div className="game-card-body">
          <span className={`badge badge-${tier}`}>{TIER_LABELS[tier]}</span>
          <h3>{game.title}</h3>
          {game.releaseYear ? <p className="muted">{game.releaseYear}</p> : null}
          {description ? <p className="description">{description}</p> : null}
          <ul className="reason-chips">
            {chips.map((chip, index) => (
              <li key={index} className={`reason-chip chip-${chip.icon}`}>
                <span className="chip-icon" aria-hidden>
                  {chip.icon === "check" ? "✓" : chip.icon === "partial" ? "~" : "✗"}
                </span>
                {chip.label}
              </li>
            ))}
          </ul>
        </div>
      </Link>

      {demoMode ? (
        <div className="demo-panel">
          <p>
            <strong>score:</strong> {score.toFixed(3)} · <strong>tier:</strong>{" "}
            {tier}
          </p>
          <p>
            <strong>coverage:</strong> {coverage.semanticDims}/13 semánticas ·{" "}
            {coverage.objectiveFields}/4 objetivo · keywords:{" "}
            {coverage.hasKeywords ? "sí" : "no"} · anclas:{" "}
            {coverage.hasAnchors ? "sí" : "no"}
          </p>
          <p>
            <strong>Top 3 razones (contribución al score):</strong>
          </p>
          <ul>
            {reasons.map((reason, index) => (
              <li key={index}>
                [{reason.block}] {reason.field} ={" "}
                {reason.contribution >= 0 ? "+" : ""}
                {reason.contribution.toFixed(4)} ({reason.kind} · {reason.note})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

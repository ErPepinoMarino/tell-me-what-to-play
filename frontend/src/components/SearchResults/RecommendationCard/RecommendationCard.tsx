"use client";

import Image from "next/image";
import type { RecommendationResultItem } from "@/types/Recommendation";
import { resultChipsWithKeywords, TIER_LABELS } from "@/lib/reasons";

type RecommendationCardProps = {
  item: RecommendationResultItem;
  requestedKeywords: string[];
  demoMode: boolean;
  onSelectGame: (item: RecommendationResultItem) => void;
};

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

/*
 * Card vertical (A3): badge de tier → título → año → imagen → chips.
 * Las chips combinan las razones del matcher y las keywords comunes con
 * lo pedido; la descripción completa vive en la ficha (GameInfo).
 */
export default function RecommendationCard({
  item,
  requestedKeywords,
  demoMode,
  onSelectGame,
}: RecommendationCardProps) {
  const { game, score, tier, coverage, reasons } = item;
  const chips = resultChipsWithKeywords(reasons, game.keywords, requestedKeywords);

  return (
    <article className={`game-card tier-${tier}`}>
      <button
        type="button"
        className="game-card-link"
        onClick={() => onSelectGame(item)}
      >
        <span className={`badge badge-${tier}`}>{TIER_LABELS[tier]}</span>
        <h3>{game.title}</h3>
        {game.releaseYear ? <p className="muted">{game.releaseYear}</p> : null}
        <div className="game-card-media">
          <Image
            src={game.coverUrl || PLACEHOLDER}
            alt={game.title}
            width={150}
            height={225}
          />
        </div>
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
      </button>

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

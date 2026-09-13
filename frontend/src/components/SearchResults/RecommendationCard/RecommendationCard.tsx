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

const BADGE_CLASSES: Record<string, string> = {
  excellent: "border-[#16a34a] text-[#4ade80]",
  valid: "border-[#2563eb] text-[#93c5fd]",
};

const CHIP_CLASSES: Record<string, string> = {
  check: "border-[#166534] text-[#4ade80]",
  partial: "border-[#92400e] text-[#fbbf24]",
  cross: "border-[#7f1d1d] text-[#f87171]",
};

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
        className="flex w-full flex-col items-center gap-2 border-none bg-transparent p-[0.9rem] text-center text-inherit [font:inherit]"
        onClick={() => onSelectGame(item)}
      >
        <span
          className={`self-center rounded-full border border-[#555] px-2 py-[0.15rem] text-[0.75rem] text-[#d1d5db] ${
            BADGE_CLASSES[tier] ?? ""
          }`}
        >
          {TIER_LABELS[tier]}
        </span>
        <h3>{game.title}</h3>
        {game.releaseYear ? (
          <p className="text-muted">{game.releaseYear}</p>
        ) : null}
        <div className="mt-1">
          <Image
            src={game.coverUrl || PLACEHOLDER}
            alt={game.title}
            width={150}
            height={225}
            className="block rounded-md object-cover"
          />
        </div>
        <ul className="m-0 mt-1 flex list-none flex-wrap justify-center gap-[0.35rem] p-0">
          {chips.map((chip, index) => (
            <li
              key={index}
              className={`rounded-full border border-[#3f3f46] px-2 py-[0.2rem] text-[0.78rem] ${
                CHIP_CLASSES[chip.icon] ?? ""
              }`}
            >
              <span className="mr-[0.3rem] font-bold" aria-hidden>
                {chip.icon === "check"
                  ? "✓"
                  : chip.icon === "partial"
                    ? "~"
                    : "✗"}
              </span>
              {chip.label}
            </li>
          ))}
        </ul>
      </button>

      {demoMode ? (
        <div className="mx-[0.9rem] mb-[0.9rem] border-t border-dashed border-[#444] pt-[0.6rem] [font-family:ui-monospace,monospace] text-[0.78rem] text-[#a1a1aa]">
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
          <ul className="mt-1 pl-4">
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

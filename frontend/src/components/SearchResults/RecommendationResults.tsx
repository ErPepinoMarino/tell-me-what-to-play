"use client";

import type { RecommendationResultItem } from "@/types/Recommendation";
import RecommendationCard from "./RecommendationCard/RecommendationCard";

type RecommendationResultsProps = {
  results: RecommendationResultItem[];
  demoMode: boolean;
  searching: boolean;
};

/*
 * SEARCH RESULTS del flujo de recomendación: fichas explicativas ordenadas
 * por el score del matcher (el backend ya filtra a tier >= valid y corta a
 * 8). Los resultados de "more" se acumulan aquí.
 */
export default function RecommendationResults({
  results,
  demoMode,
  searching,
}: RecommendationResultsProps) {
  if (results.length === 0 && !searching) return null;

  return (
    <section className="recommendation-results">
      <h2>Search Results</h2>
      {results.length === 0 ? (
        <p className="muted">Sin resultados de calidad todavía...</p>
      ) : (
        <div className="results-grid">
          {results.map((item) => (
            <RecommendationCard key={item.game.id} item={item} demoMode={demoMode} />
          ))}
        </div>
      )}
    </section>
  );
}

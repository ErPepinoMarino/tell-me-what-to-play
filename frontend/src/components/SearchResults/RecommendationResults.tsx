"use client";

import { useEffect } from "react";
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
  // Capa 3/3 de traza de streaming (pintado real): distingue "el estado se
  // actualizó pero React no pintó" de "los eventos llegaron tarde".
  useEffect(() => {
    if (results.length > 0) {
      console.debug("[stream] paint", {
        count: results.length,
        ids: results.map((item) => item.game.id),
      });
    }
  }, [results]);
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

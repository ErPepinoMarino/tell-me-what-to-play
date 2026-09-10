"use client";

import type {
  RecommendedGame,
  RecommendationMeta,
  RecommendationResultItem,
} from "@/types/Recommendation";
import {
  DemoMetaPanel,
  RequestedGamesRow,
} from "@/components/SearchResults/RecommendationExtras";
import RecommendationResults from "./RecommendationResults";

type SearchResultsProps = {
  results: RecommendationResultItem[];
  requestedGames: RecommendedGame[];
  requestedKeywords: string[];
  demoMode: boolean;
  searching: boolean;
  meta: RecommendationMeta | null;
  onSelectGame: (game: RecommendedGame) => void;
};

/*
 * SEARCH RESULTS del flujo conversacional: zona de "lo que pediste"
 * (referencia) + tandas rankeadas por el matcher. La reestructuración
 * con grid 3+3+2 y cards simplificados llega en A3; este es el skeleton
 * estructural (misma composición, sin ?q= legacy).
 */
export default function SearchResults({
  results,
  requestedGames,
  requestedKeywords,
  demoMode,
  searching,
  meta,
  onSelectGame,
}: SearchResultsProps) {
  return (
    <>
      <RequestedGamesRow games={requestedGames} onSelectGame={onSelectGame} />
      <RecommendationResults
        results={results}
        requestedKeywords={requestedKeywords}
        demoMode={demoMode}
        searching={searching}
        onSelectGame={(item) => onSelectGame(item.game)}
      />
      {demoMode && meta ? <DemoMetaPanel meta={meta} /> : null}
    </>
  );
}

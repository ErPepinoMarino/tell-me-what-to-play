import { useEffect, useState } from "react";
import type { Game } from "@/types/Game";

/*
 * Ficha completa de un juego vía GET /api/games/:slug (público, sin auth).
 * Solo se llama cuando la selección vino de un card de resultados (su DTO no
 * trae developers/publishers/semánticas); el deep-link ?game= ya llega completo
 * por SSR. En fallo de red se conserva el preview parcial (degradación honesta).
 * loading se DERIVA: true mientras el slug pendiente no tenga resultado.
 */
interface DetailOutcome {
  slug: string;
  game: Game | null;
}

export function useGameDetail(slug: string | null) {
  const [outcome, setOutcome] = useState<DetailOutcome | null>(null);

  useEffect(() => {
    if (!slug) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) setOutcome({ slug, game: null });
          return;
        }
        const data = (await res.json()) as Game;
        if (!cancelled) setOutcome({ slug, game: data });
      } catch {
        // Sin conexión con el backend: señal de finalización igualmente.
        if (!cancelled) setOutcome({ slug, game: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const game =
    outcome && outcome.slug === slug ? outcome.game : null;

  return { game, loading: !!slug && outcome?.slug !== slug };
}

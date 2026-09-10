import { useEffect, useState } from "react";
import type { Game } from "@/types/Game";

/*
 * Ficha completa de un juego vía GET /api/games/:slug (público, sin auth).
 * Solo se llama cuando la selección provino de un card de resultados
 * (cuyo DTO no trae developers/publishers/semánticas); el deep-link ?game=
 * ya llega completo por SSR y no dispara fetch. En fallo de red el
 * preview parcial se conserva tal cual (degradación honesta).
 *
 * loading se DERIVA (no hay setState en el cuerpo del effect): true
 * mientras el slug pendiente aún no tenga resultado resuelto.
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

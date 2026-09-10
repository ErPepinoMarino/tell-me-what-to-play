import { useCallback, useEffect, useState } from "react";
import { sendJson } from "@/lib/api";
import { subFromToken } from "@/lib/tokenSub";
import type { LibraryEntry } from "@/types/Library";

export type AddToLibraryOutcome = "added" | "exists" | "error";

/*
 * Biblioteca del usuario autenticado. Un ÚNICO hook por página (instancia
 * de HomeClient) para que el añadir desde GameInfo y la lista de
 * MyLibrary compartan la misma fuente de verdad.
 *
 * Nota de contrato PUT: el backend escribe TODOS los campos (missing →
 * null). El cuerpo siempre lleva el triple completo con los valores
 * vigentes; los campos null vigentes se OMITEN (omitir ≡ null en la BD).
 * "Borrar reseña" = omitir la clave review.
 */
export function useLibrary(token: string | null) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const userId = subFromToken(token);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/users/${userId}/library`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? (data as LibraryEntry[]) : []);
      }
    } catch {
      // Best-effort: se reintentará al cambiar token/montaje.
    }
  }, [token, userId]);

  useEffect(() => {
    // Falso positivo controlado (como en lib/auth.tsx): los setState de
    // load() ocurren SIEMPRE tras await fetch (continuación asíncrona),
    // nunca en el cuerpo sincrónico del effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId) void load();
  }, [load, userId]);

  const sortEntries = (rows: LibraryEntry[]) =>
    [...rows].sort((a, b) => a.games.title.localeCompare(b.games.title));

  const add = useCallback(
    async (gameId: number): Promise<AddToLibraryOutcome> => {
      if (!userId) return "error";
      const result = await sendJson<LibraryEntry>(
        "POST",
        `/api/users/${userId}/library`,
        { gameId },
        token,
      );
      if (!result.ok) {
        return result.status === 409 ? "exists" : "error";
      }
      setEntries((prev) =>
        prev
          ? sortEntries([...prev, result.data])
          : sortEntries([result.data]),
      );
      return "added";
    },
    [token, userId],
  );

  const update = useCallback(
    async (gameId: number, body: Record<string, unknown>): Promise<boolean> => {
      if (!userId) return false;
      const result = await sendJson<LibraryEntry>(
        "PUT",
        `/api/users/${userId}/library/${gameId}`,
        body,
        token,
      );
      if (!result.ok) return false;
      setEntries((previous) =>
        previous
          ? previous.map((entry) =>
              entry.game_id === gameId ? result.data : entry,
            )
          : previous,
      );
      return true;
    },
    [token, userId],
  );

  const remove = useCallback(
    async (gameId: number): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/users/${userId}/library/${gameId}`, {
          method: "DELETE",
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return false;
        setEntries((previous) =>
          previous?.filter((entry) => entry.game_id !== gameId) ?? [],
        );
        return true;
      } catch {
        return false;
      }
    },
    [token, userId],
  );

  return { entries, add, update, remove, refresh: load };
}

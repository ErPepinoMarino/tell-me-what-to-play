import HomeClient from "@/components/HomeClient";
import type { Game } from "@/types/Game";

//Más limpio sacar las props de la declaración de la función home, sino queda una guarrada verbosa.
type HomeProps = {
  searchParams: Promise<{
    game?: string;
  }>;
};

//Esto básicamente es para que no se llame al backend en la build.
//Ya que frontend y backend son apps separadas y el backend no estará disponible en la build.
//Basta solo con declarar la variable para que Next.js lo entienda.
export const dynamic = "force-dynamic";

/*
 * Server shell: solo precarga el deep-link ?game= (ficha compartible e
 * indexable). El layout y el estado compartido viven en HomeClient; la
 * búsqueda legacy ?q= pasó a la conversación (search/more/refine).
 */
export default async function Home({ searchParams }: HomeProps) {
  //ves.
  const { game } = await searchParams;

  const apiUrl = process.env.API_URL ?? "http://localhost:3001";

  async function fetchGame(path: string): Promise<Game | undefined> {
    try {
      const res = await fetch(`${apiUrl}${path}`);
      if (!res.ok) return undefined;
      return (await res.json()) as Game;
    } catch {
      return undefined;
    }
  }

  const initialGame: Game | null = game
    ? ((await fetchGame(`/api/games/${encodeURIComponent(game)}`)) ?? null)
    : null;

  return (
    <main>
      <HomeClient initialGame={initialGame} />
    </main>
  );
}

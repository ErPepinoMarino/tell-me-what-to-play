import { searchGames } from "@/actions/gameActions";

export default function SearchBar() {
  return (
    <section>
      <form action={searchGames}>
        <input
          type="text"
          name="query"
          placeholder="¿A qué te apetece jugar?"
        />

        <button type="submit">Buscar</button>
      </form>
    </section>
  );
}

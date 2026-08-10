export default function SearchBar() {
  //Uso el GET para que la búsqueda se pueda compartir en la URL y se pueda acceder a ella desde cualquier lugar.
  //Además, esto permite que los motores de búsqueda indexen la página de resultados de búsqueda. Todo ventajas.
  return (
    <section>
      <form action="/" method="GET">
        <input type="text" name="q" placeholder="¿A qué te apetece jugar?" />
        <button type="submit">Buscar</button>
      </form>
    </section>
  );
}

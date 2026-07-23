import { useState, useEffect } from "react";

function SearchBar({ onSearch }: { onSearch: (text: string) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    console.log(text);
  }, [text]);
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => onSearch(text)}>Buscar</button>
    </>
  );
}

export default SearchBar;

import Login from "@/components/Login/Login";
import PanelTitle from "@/components/PanelTitle";

/*
 * FOOTER (A7): dos columnas — izquierda, bloque de identidad de la web;
 * derecha, sesión (login/logout). Sin lógica de recomendaciones.
 */
export default function Footer() {
  return (
    <footer className="grid grid-cols-2 items-center gap-6 text-[0.85rem] text-muted max-[700px]:grid-cols-1">
      <div className="flex flex-col gap-1">
        <PanelTitle primary="TMWTP" secondary="Studio" />
        <p>
          Tell Me What To Play — recomendaciones de videojuegos guiadas por IA.
          Datos de catálogo vía IGDB.
        </p>
      </div>
      <div className="flex justify-end max-[700px]:justify-start">
        <Login />
      </div>
    </footer>
  );
}

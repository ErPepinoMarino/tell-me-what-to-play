import Login from "@/components/Login/Login";
import PanelTitle from "@/components/PanelTitle";

/*
 * FOOTER (A7): dos columnas — izquierda, bloque de identidad de la web;
 * derecha, sesión (login/logout). Sin lógica de recomendaciones.
 */
export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="app-footer-info">
        <PanelTitle primary="TMWTP" secondary="Studio" />
        <p>
          Tell Me What To Play — recomendaciones de videojuegos guiadas por IA.
          Datos de catálogo vía IGDB.
        </p>
      </div>
      <div className="app-footer-session">
        <Login />
      </div>
    </footer>
  );
}

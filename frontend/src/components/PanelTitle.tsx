type PanelTitleProps = {
  primary: string;
  secondary?: string;
};

/*
 * Título de panel según la guía de estilo TMWTP: la primera palabra en
 * verde de marca (#79b829) y la segunda (si la hay) en morado (#8b3189).
 * Los colores salen de los tokens @theme (accent-green / accent-purple).
 */
export default function PanelTitle({ primary, secondary }: PanelTitleProps) {
  return (
    <h2 className="mb-3 text-center text-[1.1rem] uppercase tracking-[0.05em] text-muted">
      <span className="text-accent-green">{primary}</span>
      {secondary ? (
        <>
          {" "}
          <span className="text-accent-purple">{secondary}</span>
        </>
      ) : null}
    </h2>
  );
}

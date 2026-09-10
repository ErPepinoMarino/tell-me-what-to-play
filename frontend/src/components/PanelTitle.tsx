type PanelTitleProps = {
  primary: string;
  secondary?: string;
};

/*
 * Título de panel según la guía de estilo TMWTP: la primera palabra en
 * verde de marca (#79b829) y la segunda (si la hay) en morado (#8b3189).
 * El estilo vive en las clases panel-title-* de globals.css.
 */
export default function PanelTitle({ primary, secondary }: PanelTitleProps) {
  return (
    <h2>
      <span className="panel-title-primary">{primary}</span>
      {secondary ? (
        <>
          {" "}
          <span className="panel-title-secondary">{secondary}</span>
        </>
      ) : null}
    </h2>
  );
}

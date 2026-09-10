import type { Game } from "@/types/Game";
import {
  GENRE_LABELS,
  MODE_LABELS,
  PERSPECTIVE_LABELS,
  THEME_LABELS,
} from "@/lib/reasons";

export const PLACEHOLDER_COVER = "/images/ImagePlaceHolder.webp";

export type InfoGroup = {
  label: string;
  values: string[];
  labels?: Record<string, string>;
};

function chipGroup(label: string, values: string[], labels?: Record<string, string>) {
  if (values.length === 0) return null;
  return (
    <div className="game-info-row">
      <strong className="game-info-inline-label">{label}:</strong>
      <ul className="reason-chips">
        {values.map((value) => (
          <li key={value} className="reason-chip">
            {labels ? (labels[value] ?? value) : value}
          </li>
        ))}
      </ul>
    </div>
  );
}

const GROUPS: InfoGroup[] = [
  { label: "Género", values: [], labels: GENRE_LABELS },
  { label: "Temática", values: [], labels: THEME_LABELS },
  { label: "Modo de juego", values: [], labels: MODE_LABELS },
  { label: "Perspectiva", values: [], labels: PERSPECTIVE_LABELS },
  { label: "Plataformas", values: [] },
];

/*
 * Cuerpo informativo de ficha (A4/A5), compartido por GameInfo y el
 * panel de detalle de MyLibrary: descripción, estudios, grupos en negrita
 * con chips al lado y temas/keywords centrados.
 */
export default function GameInfoBody({ game }: { game: Game }) {
  const filled: InfoGroup[] = [
    { ...GROUPS[0], values: game.genres },
    { ...GROUPS[1], values: game.themes },
    { ...GROUPS[2], values: game.gameModes },
    { ...GROUPS[3], values: game.perspectives },
    { ...GROUPS[4], values: game.platforms },
  ];
  const description = game.description_es || game.description_en || "Sin descripción.";

  return (
    <>
      <div className="game-info-flow">
        <p className="game-info-description">{description}</p>
        {game.developers.length > 0 ? (
          <p className="muted">Desarrollado por {game.developers.join(", ")}.</p>
        ) : null}
        {game.publishers.length > 0 ? (
          <p className="muted">Publicado por {game.publishers.join(", ")}.</p>
        ) : null}

        {filled.map((group) => chipGroup(group.label, group.values, group.labels))}
      </div>

      {game.keywords.length > 0 ? (
        <div className="game-info-keywords">
          <span className="game-info-label">Temas / Keywords</span>
          <ul className="reason-chips">
            {game.keywords.map((keyword) => (
              <li key={keyword} className="reason-chip">
                {keyword}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

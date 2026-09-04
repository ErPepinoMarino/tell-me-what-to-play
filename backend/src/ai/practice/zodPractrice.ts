import {
  GameSearchIntentSchema,
  type GameSearchIntent,
} from "../../types/GameSearchIntent.js";

// El contrato definitivo exige TODAS las claves presentes (opcionalidad = null),
// así que construimos base reutilizables y hacemos override por caso.
const nullSemantics = {
  complexity: null,
  coziness: null,
  darkness: null,
  difficulty: null,
  exploration: null,
  horror: null,
  humor: null,
  isolation: null,
  narrative: null,
  pace: null,
  strategy: null,
  tension: null,
  violence: null,
} satisfies GameSearchIntent["semantic"];

const nullObjective = {
  genres: null,
  platforms: null,
  gameModes: null,
  perspectives: null,
} satisfies NonNullable<GameSearchIntent["objective"]>;

const emptyIntent = {
  gameReferenced: null,
  objective: null,

  keywords: null,
  releaseYear: null,
  yearFrom: null,
  yearTo: null,
  excluded: null,
  semantic: null,
} satisfies GameSearchIntent;

const intent: GameSearchIntent = {
  ...emptyIntent,
  objective: {
    ...nullObjective,
    genres: ["RPG"],
    platforms: ["SWITCH"],
  },
  semantic: {
    ...nullSemantics,
    horror: 0.8,
    humor: null,
  },
};

console.log(GameSearchIntentSchema.safeParse(intent));

const testCases: { label: string; intent: GameSearchIntent }[] = [
  //Juego completamente vacío (todo null: nada inferible)
  {
    label: "1. Completamente vacío",
    intent: { ...emptyIntent },
  },
  // 2. Solo RPG + SWITCH
  {
    label: "2. Solo RPG + SWITCH",
    intent: {
      ...emptyIntent,
      objective: {
        ...nullObjective,
        genres: ["RPG"],
        platforms: ["SWITCH"],
      },
    },
  },
  // 3. Un juego referenciado (ej: "Hollow Knight")
  {
    label: "3. Un juego referenciado",
    intent: {
      ...emptyIntent,
      gameReferenced: ["Hollow Knight"],
    },
  },
  // 4. Varias semánticas (ej: horror alto, narrative medio)
  {
    label: "4. Varias semánticas",
    intent: {
      ...emptyIntent,
      semantic: {
        ...nullSemantics,
        horror: 0.8,
        narrative: 0.5,
      },
    },
  },
  // 5. Valores 0 y 1 en semánticas (0 = ausencia total, 1 = tema central)
  {
    label: "5. Valores 0 y 1 en semánticas",
    intent: {
      ...emptyIntent,
      semantic: { ...nullSemantics, humor: 0, horror: 1 },
    },
  },
  // 6. Un null en alguna semántica (todas null = nada inferido)
  {
    label: "6. Nulls en semánticas",
    intent: {
      ...emptyIntent,
      semantic: { ...nullSemantics },
    },
  },
  // 7. Un valor semántico fuera de 0..1 (ej: violence: 7)
  {
    label: "7. Un valor semántico fuera de 0..1",
    intent: {
      ...emptyIntent,
      semantic: { ...nullSemantics, violence: 7 },
    },
  },
  // 9. Keywords: vocabulario abierto, múltiples términos temáticos
  {
    label: "9. Keywords (vocabulario abierto)",
    intent: {
      ...emptyIntent,
      keywords: ["western", "cooking", "pirates"],
    },
  },
  // 8. Un enum inexistente (ej: genre "PLATAFORMAS")
  //DEJO ESTO COMENTADO PARA QUE SE PUEDA EJECUTAR (el compilador lo impide).
  /*{
    label: "8. Un enum inexistente",
    intent: { ...emptyIntent, objective: { ...nullObjective, genres: ["PLATAFORMAS"] } },
  },*/
];

for (const { label, intent } of testCases) {
  const result = GameSearchIntentSchema.safeParse(intent);
  console.log(
    `${result.success ? "✅" : "❌"} ${label}`,
    result.success
      ? ""
      : JSON.stringify(
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        ),
  );
}

const caso8: unknown = { objective: { genres: ["PLATAFORMAS"] } };
const result8 = GameSearchIntentSchema.safeParse(caso8);
if (result8.success) {
  console.log("❌ caso8 pasó la validación cuando NO debía");
} else {
  console.log(
    "❌ caso8 rechazado correctamente:",
    JSON.stringify(result8.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)),
  );
}

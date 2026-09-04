// Abstracción de la investigación web que alimenta el agente de enriquecimiento.
// Igual que HttpClient en IGDB: se abstrae para inyectar un fake en los tests
// y para decidir más adelante la fuente real (buscador vs foros) sin tocar el resto.

// Evidencia: texto que una fuente web aporta sobre el juego.
// https: opcional, para citar la procedencia en el prompt.
export interface Evidence {
  source: string;
  snippet: string;
}

export interface ResearchProvider {
  // Busca evidencias relevantes para el juego, dada una query textual.
  searchEvidence(query: string): Promise<Evidence[]>;
}

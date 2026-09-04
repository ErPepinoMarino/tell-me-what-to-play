import { mapToCandidate } from "../igdb/mappers.js";
import { shouldSkipNonIndependentGame } from "../igdb/gameType.js";
import type { IgdbClient } from "../igdb/types.js";
import type { Game, GameToPersist } from "../types/Game.js";
import type { EnrichmentService } from "./enrichmentService.js";

export type { EnrichmentService };

export interface ImportResult {
  created: number;
  skipped: number;
  errors: Array<{ rawId: number; error: Error }>;
}

export interface GameRepository {
  getBySlug(slug: string): Promise<Game | undefined>;
  create(game: GameToPersist): Promise<Game>;
}

export class ImportService {
  constructor(
    private igdbClient: IgdbClient,
    private enrichmentService: EnrichmentService,
    private repository: GameRepository,
  ) {}

  async importByQuery(query: string, limit = 10): Promise<ImportResult> {
    const raws = await this.igdbClient.searchGames(query, limit);

    const result: ImportResult = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    for (const raw of raws) {
      try {
        if (shouldSkipNonIndependentGame(raw)) {
          result.skipped++;
          continue;
        }

        const candidate = mapToCandidate(raw);

        const existing = await this.repository.getBySlug(candidate.slug);
        if (existing) {
          result.skipped++;
          continue;
        }

        const enriched = await this.enrichmentService.enrich(candidate);
        await this.repository.create(enriched);
        result.created++;
      } catch (error) {
        result.errors.push({
          rawId: raw.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return result;
  }
}

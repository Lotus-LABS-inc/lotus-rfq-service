import type { Logger } from "pino"

import type { MyriadClient, MyriadPaginatedQuestionsQuery } from "./myriad-client.js"
import type { MyriadQuestion } from "./myriad-schemas.js"

export interface MyriadQuestionCrawlerConfig {
  client: Pick<MyriadClient, "listQuestions">;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface MyriadQuestionCrawlerResult {
  questions: readonly MyriadQuestion[];
  pagesFetched: number;
}

export class MyriadQuestionCrawler {
  public constructor(private readonly config: MyriadQuestionCrawlerConfig) {}

  public async crawlAll(query: Omit<MyriadPaginatedQuestionsQuery, "page" | "limit"> & { limit?: number } = {}): Promise<MyriadQuestionCrawlerResult> {
    const limit = Math.min(query.limit ?? 100, 100)
    let page = 1
    let pagesFetched = 0
    const questions: MyriadQuestion[] = []

    while (true) {
      const response = await this.config.client.listQuestions({ ...query, page, limit })
      pagesFetched += 1
      questions.push(...response.data)
      this.config.logger?.info({ page, limit, returned: response.data.length }, "Fetched Myriad questions page.")
      if (!response.pagination.hasNext) {
        break
      }
      page += 1
    }

    return {
      questions: questions.sort((left, right) => String(left.id).localeCompare(String(right.id))),
      pagesFetched
    }
  }
}

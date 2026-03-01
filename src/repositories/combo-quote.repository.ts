import type { Pool } from "pg";
import { ComboQuote } from "../core/combo-engine/types.js";

/**
 * Interface for database operations handling LP quotes for Combo RFQs.
 */
export interface IComboQuoteRepository {
    saveQuote(quote: ComboQuote): Promise<void>;
    getQuotesForSession(sessionId: string): Promise<ComboQuote[]>;
}

export class ComboQuoteRepository implements IComboQuoteRepository {
    public constructor(private readonly pool: Pool) { }

    /**
     * Persists a Combo Quote (wholistic or multi-leg definition).
     */
    public async saveQuote(quote: ComboQuote): Promise<void> {
        // TODO: Insert into combo_quotes
        throw new Error("Method not implemented.");
    }

    /**
     * Retrieves all valid quotes associated with a Combo RFQ.
     */
    public async getQuotesForSession(sessionId: string): Promise<ComboQuote[]> {
        // TODO: Select from combo_quotes where valid
        throw new Error("Method not implemented.");
    }
}

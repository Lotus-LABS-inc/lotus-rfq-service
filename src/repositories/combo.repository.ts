import type { Pool, PoolClient } from "pg";
import { ComboRFQSession, ComboLeg } from "../core/combo-engine/types.js";

/**
 * Interface for database operations on Combo RFQs and Legs.
 */
export interface IComboRepository {
    createSession(session: ComboRFQSession, client?: PoolClient): Promise<void>;
    getSession(sessionId: string): Promise<ComboRFQSession | null>;
    updateSessionState(sessionId: string, state: ComboRFQSession["state"], client?: PoolClient): Promise<void>;
    // TODO: add idempotency checks, execution event creation
}

export class ComboRepository implements IComboRepository {
    public constructor(private readonly pool: Pool) { }

    /**
     * Persists a newly created Combo RFQ Session atomically with its legs.
     */
    public async createSession(session: ComboRFQSession, client?: PoolClient): Promise<void> {
        // TODO: Insert into combo_rfqs
        // TODO: Insert into combo_legs 
        throw new Error("Method not implemented.");
    }

    /**
     * Retrieves a Combo RFQ session and its corresponding legs.
     */
    public async getSession(sessionId: string): Promise<ComboRFQSession | null> {
        // TODO: Join combo_rfqs and combo_legs
        throw new Error("Method not implemented.");
    }

    /**
     * Atomically updates state (e.g., OPEN -> ACCEPTED).
     */
    public async updateSessionState(sessionId: string, state: ComboRFQSession["state"], client?: PoolClient): Promise<void> {
        // TODO: Update statement
        throw new Error("Method not implemented.");
    }
}

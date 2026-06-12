import { describe, expect, it, vi } from "vitest";

import { CanonicalGraphProjector } from "../../src/canonical/canonical-graph-projector.js";
import type { CanonicalGraphSnapshot } from "../../src/repositories/canonical-graph.repository.js";

describe("CanonicalGraphProjector", () => {
    it("persists canonical graph state before projecting read models", async () => {
        const repository = {
            persistSnapshot: vi.fn().mockResolvedValue(undefined),
            projectResolutionReadModels: vi.fn().mockResolvedValue([])
        };
        const compatibilityProjector = {
            persistSnapshot: vi.fn().mockResolvedValue(undefined)
        };
        const projector = new CanonicalGraphProjector(repository as never, compatibilityProjector as never);
        const snapshot: CanonicalGraphSnapshot = {
            canonicalEvents: [],
            canonicalFixtureEvents: [],
            canonicalEventFixtureLinks: new Map(),
            venueMarketProfiles: [],
            propositionFingerprints: [],
            resolutionProfiles: [],
            settlementProfiles: [],
            compatibilityEdges: [],
            executableMarkets: []
        };

        await projector.persistAndProject(snapshot);

        expect(repository.persistSnapshot).toHaveBeenCalledWith(snapshot);
        expect(compatibilityProjector.persistSnapshot).toHaveBeenCalledWith(snapshot);
        expect(repository.projectResolutionReadModels).toHaveBeenCalledWith(snapshot);
        expect(repository.persistSnapshot.mock.calls).toHaveLength(1);
        expect(compatibilityProjector.persistSnapshot.mock.calls).toHaveLength(1);
        expect(repository.projectResolutionReadModels.mock.calls).toHaveLength(1);
    });
});

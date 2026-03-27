import { CanonicalGraphRepository, type CanonicalGraphSnapshot } from "../repositories/canonical-graph.repository.js";
import type { CanonicalCompatibilityProjector } from "./canonical-compatibility-projector.js";

export class CanonicalGraphProjector {
    public constructor(
        private readonly repository: CanonicalGraphRepository,
        private readonly compatibilityProjector?: CanonicalCompatibilityProjector
    ) {}

    public async persistAndProject(snapshot: CanonicalGraphSnapshot): Promise<void> {
        await this.repository.persistSnapshot(snapshot);
        await this.compatibilityProjector?.persistSnapshot(snapshot);
        await this.repository.projectResolutionReadModels(snapshot);
    }
}

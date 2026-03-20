import { CanonicalGraphRepository, type CanonicalGraphSnapshot } from "../repositories/canonical-graph.repository.js";

export class CanonicalGraphProjector {
    public constructor(private readonly repository: CanonicalGraphRepository) {}

    public async persistAndProject(snapshot: CanonicalGraphSnapshot): Promise<void> {
        await this.repository.persistSnapshot(snapshot);
        await this.repository.projectResolutionReadModels(snapshot);
    }
}

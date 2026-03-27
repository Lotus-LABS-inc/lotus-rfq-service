import type { InterpretedContractBuildInput, InterpretedContract } from "./interpreted-contract-types.js";
import { buildInterpretedContractRecord } from "./interpreted-contract.js";

export class InterpretedContractBuilder {
    public build(input: InterpretedContractBuildInput): InterpretedContract {
        return buildInterpretedContractRecord(input);
    }
}

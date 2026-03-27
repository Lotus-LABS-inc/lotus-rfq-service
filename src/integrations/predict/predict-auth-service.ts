import type { PredictClient, PredictJwtResponse } from "./predict-client.js";

export interface PredictAuthServiceConfig {
  client: Pick<PredictClient, "getAuthMessage" | "getJwtWithValidSignature">;
}

export class PredictAuthService {
  public constructor(private readonly config: PredictAuthServiceConfig) {}

  public async getEoaAuthMessage(address: string): Promise<string> {
    const response = await this.config.client.getAuthMessage(address);
    return response.message;
  }

  public async exchangeSignatureForJwt(input: {
    address: string;
    message: string;
    signature: string;
  }): Promise<PredictJwtResponse> {
    return this.config.client.getJwtWithValidSignature(input);
  }
}

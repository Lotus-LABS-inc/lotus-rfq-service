export interface FundingIntentResponse {
  fundingIntentId: string;
  currentStatus: string;
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  sourceWalletId: string | null;
  sourceWalletAddress: string;
  routeLegs: FundingRouteLegResponse[];
  userSafeMessage: string;
}

export type LotusRouteMode = "FUNDING" | "WITHDRAWAL";

export interface FundingRouteLegResponse {
  routeLegId: string;
  targetVenue: string;
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: string;
  destinationToken: string;
  destinationAmountEstimate: string;
  routeProvider: string;
  status: string;
  routeQuote: {
    provider: string;
    providerRouteId: string | null;
    expiresAt: string;
    transactionRequest: {
      data?: string;
      from?: string;
      to?: string;
      chainId?: number;
      value?: string;
    } | null;
    userSafeSummary: string;
  };
}

export interface TurnkeyWalletAccountLike {
  address?: string;
  addressFormat?: string;
  walletAccountId?: string;
  walletId?: string;
}

export interface TurnkeyWalletLike {
  walletId?: string;
  walletName?: string;
  source?: string;
  accounts?: TurnkeyWalletAccountLike[];
}

export interface WithdrawalIntentResponse {
  withdrawalIntentId: string;
  currentStatus: string;
  token: string;
  amount: string;
  destinationChain: string;
  destinationWalletAddress: string;
  routeLegs: WithdrawalRouteLegResponse[];
  userSafeMessage: string;
}

export interface WithdrawalRouteLegResponse {
  withdrawalRouteLegId: string;
  sourceVenue: string;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: string;
  destinationWalletAddress: string;
  destinationAmountEstimate: string;
  routeProvider: string;
  status: string;
  providerStatus?: {
    sourceWalletAddress?: string;
    destinationToken?: string;
    sourceChain?: string;
    sourceToken?: string;
    mode?: string;
  };
  routeQuote: {
    provider: string;
    providerRouteId: string | null;
    expiresAt: string;
    transactionRequest: {
      data?: string;
      from?: string;
      to?: string;
      chainId?: number;
      value?: string;
    } | null;
    userSafeSummary: string;
  };
}

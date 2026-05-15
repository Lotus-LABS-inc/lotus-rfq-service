import type { UserWallet } from "./user-wallets.js";

export type UserWalletBalanceStatus = "synced" | "unavailable" | "unsupported";

export interface UserWalletTokenBalance {
  token: string;
  amount: string;
  chain: string;
  chainFamily: "EVM" | "SOLANA";
  updatedAt: string;
  status: "available";
}

export interface UserWalletBalanceResult {
  balances: UserWalletTokenBalance[];
  balanceStatus: UserWalletBalanceStatus;
  balanceBlocker: string | null;
}

export interface UserWalletBalanceReaderConfig {
  env?: NodeJS.ProcessEnv | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface EvmTokenBalanceTarget {
  chain: string;
  rpcUrl: string;
  token: string;
  tokenAddress: string;
  decimals: number;
}

interface SolanaTokenBalanceTarget {
  token: string;
  mint: string;
}

const requestTimeoutMs = 8_000;

export class UserWalletBalanceReader {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: UserWalletBalanceReaderConfig = {}) {
    this.env = config.env ?? process.env;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async readWalletBalances(wallet: UserWallet): Promise<UserWalletBalanceResult> {
    if (wallet.status !== "ACTIVE" || wallet.purpose !== "DEFAULT_FUNDING") {
      return {
        balances: [],
        balanceStatus: "unsupported",
        balanceBlocker: "Balances are only synced for active Lotus funding wallets."
      };
    }

    try {
      if (wallet.chainFamily === "EVM") {
        return await this.readEvmWalletBalances(wallet);
      }
      if (wallet.chainFamily === "SOLANA") {
        return await this.readSolanaWalletBalances(wallet);
      }
      return {
        balances: [],
        balanceStatus: "unsupported",
        balanceBlocker: "Wallet chain family is not supported for balance sync."
      };
    } catch {
      return {
        balances: [],
        balanceStatus: "unavailable",
        balanceBlocker: "Funding wallet balance sync is temporarily unavailable."
      };
    }
  }

  private async readEvmWalletBalances(wallet: UserWallet): Promise<UserWalletBalanceResult> {
    if (!isEvmAddress(wallet.address)) {
      return {
        balances: [],
        balanceStatus: "unavailable",
        balanceBlocker: "Funding wallet EVM address is unavailable."
      };
    }

    const targets = buildEvmTargets(this.env);
    if (targets.length === 0) {
      return {
        balances: [],
        balanceStatus: "unavailable",
        balanceBlocker: "No EVM RPC/token balance readers are configured."
      };
    }

    const settled = await Promise.allSettled(
      targets.map(async (target): Promise<UserWalletTokenBalance> => {
        const atomic = await this.readErc20Balance(target, wallet.address);
        return {
          token: target.token,
          amount: formatBaseUnits(atomic, target.decimals),
          chain: target.chain,
          chainFamily: "EVM" as const,
          updatedAt: new Date().toISOString(),
          status: "available" as const
        };
      })
    );
    const balances = settled
      .filter((result): result is PromiseFulfilledResult<UserWalletTokenBalance> => result.status === "fulfilled")
      .map((result) => result.value);

    return {
      balances,
      balanceStatus: balances.length > 0 ? "synced" : "unavailable",
      balanceBlocker: balances.length > 0 ? null : "EVM token balance reads did not return usable data."
    };
  }

  private async readSolanaWalletBalances(wallet: UserWallet): Promise<UserWalletBalanceResult> {
    const rpcUrls = uniqueNonEmpty([
      firstNonEmpty(this.env.SOLANA_RPC_URL, this.env.VITE_SOLANA_RPC_URL),
      "https://api.mainnet-beta.solana.com"
    ]);

    const updatedAt = new Date().toISOString();
    const targets = buildSolanaTargets(this.env);

    for (const rpcUrl of rpcUrls) {
      const balanceReadPromises: Array<Promise<UserWalletTokenBalance>> = [
        this.readSolanaNativeBalance(rpcUrl, wallet.address).then((atomic) => ({
          token: "SOL",
          amount: formatBaseUnits(atomic, 9),
          chain: "SOLANA",
          chainFamily: "SOLANA" as const,
          updatedAt,
          status: "available" as const
        })),
        ...targets.map(async (target): Promise<UserWalletTokenBalance> => {
          const atomic = await this.readSolanaSplTokenBalance(rpcUrl, wallet.address, target.mint);
          return {
            token: target.token,
            amount: formatBaseUnits(atomic, 6),
            chain: "SOLANA",
            chainFamily: "SOLANA" as const,
            updatedAt,
            status: "available" as const
          };
        })
      ];
      const balanceReads = await Promise.allSettled(balanceReadPromises);

      const balances = balanceReads
        .filter((result): result is PromiseFulfilledResult<UserWalletTokenBalance> => result.status === "fulfilled")
        .map((result) => result.value);

      if (balances.length > 0) {
        return {
          balances,
          balanceStatus: "synced",
          balanceBlocker: null
        };
      }
    }

    return {
      balances: [],
      balanceStatus: "unavailable",
      balanceBlocker: "Solana balance reads did not return usable data."
    };
  }

  private async readErc20Balance(target: EvmTokenBalanceTarget, ownerAddress: string): Promise<bigint> {
    const data = `0x70a08231${ownerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    const payload = await this.rpc(target.rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: target.tokenAddress, data }, "latest"]
    });
    if (typeof payload.result !== "string" || !/^0x[a-fA-F0-9]+$/.test(payload.result)) {
      throw new Error("Malformed ERC20 balance response.");
    }
    return BigInt(payload.result);
  }

  private async readSolanaNativeBalance(rpcUrl: string, ownerAddress: string): Promise<bigint> {
    const payload = await this.rpc(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [ownerAddress, { commitment: "confirmed" }]
    });
    const value = (payload.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error("Malformed Solana native balance response.");
    }
    return BigInt(value);
  }

  private async readSolanaSplTokenBalance(rpcUrl: string, ownerAddress: string, mint: string): Promise<bigint> {
    const payload = await this.rpc(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        ownerAddress,
        { mint },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ]
    });
    const accounts = (payload.result as { value?: unknown[] } | undefined)?.value;
    if (!Array.isArray(accounts)) {
      throw new Error("Malformed Solana token account balance response.");
    }
    return accounts.reduce<bigint>((total, account) => {
      const amount = readJsonParsedTokenAmount(account);
      return amount === null ? total : total + amount;
    }, 0n);
  }

  private async rpc(rpcUrl: string, body: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> {
    const response = await this.fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) {
      throw new Error("RPC balance read failed.");
    }
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error) {
      throw new Error("RPC balance read returned an error.");
    }
    return payload;
  }
}

export const buildUserWalletBalanceReaderFromEnv = (env: NodeJS.ProcessEnv = process.env): UserWalletBalanceReader =>
  new UserWalletBalanceReader({ env });

const buildEvmTargets = (env: NodeJS.ProcessEnv): EvmTokenBalanceTarget[] => {
  const polygonRpcUrl = firstNonEmpty(env.POLYGON_RPC_URL, env.POLYMARKET_POLYGON_RPC_URL) ?? "https://polygon-rpc.com";
  const baseRpcUrl = firstNonEmpty(env.BASE_RPC_URL, env.LIMITLESS_BASE_RPC_URL) ?? "https://mainnet.base.org";
  const bscRpcUrl = firstNonEmpty(
    env.BSC_RPC_URL,
    env.BNB_RPC_URL,
    env.PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL,
    env.MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL,
    env.OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL
  ) ?? "https://bsc-dataseed.binance.org";
  const targets: EvmTokenBalanceTarget[] = [];
  if (polygonRpcUrl) {
    targets.push({
      chain: "POLYGON",
      rpcUrl: polygonRpcUrl,
      token: "USDC",
      tokenAddress: firstNonEmpty(env.POLYGON_USDC_TOKEN_ADDRESS) ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      decimals: 6
    });
    const polygonUsdt = firstNonEmpty(env.POLYGON_USDT_TOKEN_ADDRESS) ?? "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
    if (polygonUsdt) {
      targets.push({
        chain: "POLYGON",
        rpcUrl: polygonRpcUrl,
        token: "USDT",
        tokenAddress: polygonUsdt,
        decimals: 6
      });
    }
  }
  if (baseRpcUrl) {
    targets.push({
      chain: "BASE",
      rpcUrl: baseRpcUrl,
      token: "USDC",
      tokenAddress: firstNonEmpty(env.BASE_USDC_TOKEN_ADDRESS, env.LIMITLESS_USDC_TOKEN_ADDRESS) ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6
    });
  }
  if (bscRpcUrl) {
    targets.push({
      chain: "BSC",
      rpcUrl: bscRpcUrl,
      token: "USDC",
      tokenAddress: firstNonEmpty(env.BSC_USDC_TOKEN_ADDRESS) ?? "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      decimals: 18
    });
    targets.push({
      chain: "BSC",
      rpcUrl: bscRpcUrl,
      token: "USDT",
      tokenAddress: firstNonEmpty(env.BSC_USDT_TOKEN_ADDRESS) ?? "0x55d398326f99059fF775485246999027B3197955",
      decimals: 18
    });
  }
  return targets.filter((target) => isEvmAddress(target.tokenAddress));
};

const buildSolanaTargets = (env: NodeJS.ProcessEnv): SolanaTokenBalanceTarget[] => [
  {
    token: "USDC",
    mint: firstNonEmpty(env.SOLANA_USDC_TOKEN_ADDRESS) ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  },
  {
    token: "USDT",
    mint: firstNonEmpty(env.SOLANA_USDT_TOKEN_ADDRESS) ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY1p8ARw5ygP2Z7n"
  }
];

const readJsonParsedTokenAmount = (account: unknown): bigint | null => {
  const amount = (((account as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } } } }).account?.data?.parsed?.info?.tokenAmount?.amount));
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    return null;
  }
  return BigInt(amount);
};

const formatBaseUnits = (atomic: bigint, decimals: number): string => {
  if (atomic === 0n) {
    return "0";
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = atomic / divisor;
  const fraction = atomic % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
};

const firstNonEmpty = (...values: Array<string | undefined>): string | null =>
  values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;

const uniqueNonEmpty = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))];

const isEvmAddress = (value: string): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(value.trim());

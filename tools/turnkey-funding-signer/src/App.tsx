import { useMemo, useState } from "react";
import { KeyFormat, useTurnkey } from "@turnkey/react-wallet-kit";
import { serializeTransaction } from "viem";
import { getFundingIntent, quoteFundingIntent, submitFundingTxHash } from "./api";
import type { FundingIntentResponse, FundingRouteLegResponse, TurnkeyWalletAccountLike, TurnkeyWalletLike } from "./types";

const DEFAULT_INTENT_ID = "";
const DEFAULT_ROUTE_LEG_ID = "";
const DEFAULT_REQUIRED_SUB_ORG_ID = "94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb";
const DEFAULT_SOLANA_RPC_URL = "https://solana-rpc.publicnode.com";
const DEFAULT_BSC_RPC_URL = "https://bsc-dataseed.binance.org";
const SOLANA_TRANSACTION_TYPE = "TRANSACTION_TYPE_SOLANA";
const ETHEREUM_TRANSACTION_TYPE = "TRANSACTION_TYPE_ETHEREUM";
type RouteSigningKind = "SOLANA" | "EVM" | "UNKNOWN";

type StepState = "idle" | "loading" | "ready" | "signing" | "submitted" | "error";

type SignTransaction = (params: {
  walletAccount: TurnkeyWalletAccountLike;
  unsignedTransaction: string;
  transactionType: string;
  organizationId?: string;
}) => Promise<string>;

type SignAndSendTransaction = (params: {
  walletAccount: TurnkeyWalletAccountLike;
  unsignedTransaction: string;
  transactionType: string;
  rpcUrl?: string;
  organizationId?: string;
}) => Promise<string>;

type CreateWallet = (params: {
  walletName: string;
  accounts: Array<"ADDRESS_FORMAT_SOLANA" | "ADDRESS_FORMAT_ETHEREUM">;
  organizationId?: string;
}) => Promise<unknown>;

type ExportWallet = (params: {
  walletId: string;
  organizationId?: string;
}) => Promise<void>;

type ExportWalletAccount = (params: {
  address: string;
  keyFormat?: KeyFormat;
  organizationId?: string;
}) => Promise<void>;

const isSolanaAccount = (account: TurnkeyWalletAccountLike): boolean => {
  const format = account.addressFormat?.toUpperCase() ?? "";
  return format.includes("SOLANA");
};

const isEthereumAccount = (account: TurnkeyWalletAccountLike): boolean => {
  const format = account.addressFormat?.toUpperCase() ?? "";
  return format.includes("ETHEREUM") || /^0x[a-fA-F0-9]{40}$/.test(account.address ?? "");
};

const normalizeAddress = (value: string | undefined): string => (value ?? "").trim();
const normalizeComparableAddress = (value: string | undefined): string => normalizeAddress(value).toLowerCase();

const isHexTransaction = (value: string): boolean => /^(?:0x)?[0-9a-fA-F]+$/.test(value) && value.replace(/^0x/i, "").length % 2 === 0;

const base64ToHex = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
  const binary = atob(padded);
  return Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
};

const hexToBase64 = (value: string): string => {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!isHexTransaction(normalized)) {
    throw new Error("Turnkey returned a signed transaction that is not valid hex.");
  }
  const bytes = normalized.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
};

const toTurnkeySolanaUnsignedTransaction = (value: string): string => {
  const trimmed = value.trim();
  if (isHexTransaction(trimmed)) {
    return trimmed.replace(/^0x/i, "");
  }
  return base64ToHex(trimmed);
};

const broadcastSignedSolanaTransaction = async (signedTransactionHex: string, rpcUrl: string): Promise<string> => {
  const signedTransactionBase64 = hexToBase64(signedTransactionHex);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [
        signedTransactionBase64,
        {
          encoding: "base64",
          preflightCommitment: "confirmed",
          maxRetries: 3
        }
      ]
    })
  });
  const payload = await response.json().catch(() => null) as { result?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || payload?.error) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : `${response.status} ${response.statusText}`.trim();
    throw new Error(`Solana RPC Error: ${message}`);
  }
  if (typeof payload?.result !== "string" || payload.result.length === 0) {
    throw new Error("Solana RPC did not return a transaction signature.");
  }
  return payload.result;
};

const formatSafeError = (error: unknown): string => {
  if (error instanceof Error) {
    const maybeDetails = error as Error & { code?: unknown; cause?: unknown; details?: unknown };
    const pieces = [
      error.message,
      typeof maybeDetails.code === "string" || typeof maybeDetails.code === "number" ? `code=${maybeDetails.code}` : null,
      maybeDetails.details ? `details=${JSON.stringify(maybeDetails.details)}` : null,
      maybeDetails.cause instanceof Error ? `cause=${maybeDetails.cause.message}` : null
    ].filter((value): value is string => value !== null && value.length > 0);
    return pieces.join(" | ");
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error.";
  }
};

const findMatchingSolanaAccount = (
  wallets: TurnkeyWalletLike[],
  sourceWalletAddress: string | undefined
): TurnkeyWalletAccountLike | null => {
  const accounts = wallets.flatMap((wallet) => wallet.accounts ?? []);
  const normalizedSource = normalizeAddress(sourceWalletAddress);
  if (!normalizedSource) {
    return accounts.find(isSolanaAccount) ?? accounts[0] ?? null;
  }
  const exactAddressMatch = accounts.find((account) => normalizeAddress(account.address) === normalizedSource);
  if (exactAddressMatch) {
    return exactAddressMatch;
  }
  return accounts.find(isSolanaAccount) ?? null;
};

const findMatchingRouteAccount = (
  wallets: TurnkeyWalletLike[],
  sourceWalletAddress: string | undefined,
  routeKind: RouteSigningKind
): TurnkeyWalletAccountLike | null => {
  if (routeKind === "SOLANA") {
    return findMatchingSolanaAccount(wallets, sourceWalletAddress);
  }
  if (routeKind === "UNKNOWN") {
    return null;
  }
  const accounts = wallets.flatMap((wallet) => wallet.accounts ?? []);
  const normalizedSource = normalizeComparableAddress(sourceWalletAddress);
  if (!normalizedSource) {
    return accounts.find(isEthereumAccount) ?? accounts[0] ?? null;
  }
  const exactAddressMatch = accounts.find((account) => normalizeComparableAddress(account.address) === normalizedSource);
  if (exactAddressMatch) {
    return exactAddressMatch;
  }
  return accounts.find(isEthereumAccount) ?? null;
};

const findWalletForAccount = (
  wallets: TurnkeyWalletLike[],
  account: TurnkeyWalletAccountLike | null
): TurnkeyWalletLike | null => {
  if (!account) {
    return null;
  }
  const normalizedAccountAddress = normalizeAddress(account.address);
  const directWalletId = normalizeAddress(account.walletId);
  return wallets.find((wallet) => {
    if (directWalletId && normalizeAddress(wallet.walletId) === directWalletId) {
      return true;
    }
    return (wallet.accounts ?? []).some((candidate) => {
      const sameAccountId = account.walletAccountId
        && candidate.walletAccountId
        && candidate.walletAccountId === account.walletAccountId;
      const sameAddress = normalizedAccountAddress
        && normalizeAddress(candidate.address) === normalizedAccountAddress;
      return sameAccountId || sameAddress;
    });
  }) ?? null;
};

const selectPreferredLeg = (response: FundingIntentResponse, preferredRouteLegId: string): FundingRouteLegResponse | null => {
  const preferred = preferredRouteLegId.trim()
    ? response.routeLegs.find((leg) => leg.routeLegId === preferredRouteLegId.trim()) ?? null
    : null;
  return preferred ?? response.routeLegs[0] ?? null;
};

const routeSigningKind = (leg: FundingRouteLegResponse | null): RouteSigningKind => {
  if (!leg) {
    return "UNKNOWN";
  }
  return leg.routeProvider === "DIRECT_TRANSFER" ? "EVM" : "SOLANA";
};

const evmCaip2 = (chainId: number | undefined): string => `eip155:${chainId ?? 1}`;

const bigintFromRpcQuantity = (value: string | undefined, fallback = 0n): bigint => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.startsWith("0x")) {
    return BigInt(trimmed);
  }
  return BigInt(trimmed);
};

const numberFromRpcQuantity = (value: string): number => Number(bigintFromRpcQuantity(value));

const toRpcQuantity = (value: string | undefined, fallback = 0n): string => `0x${bigintFromRpcQuantity(value, fallback).toString(16)}`;

const rpcCall = async <T,>(rpcUrl: string, method: string, params: unknown[]): Promise<T> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const payload = await response.json().catch(() => null) as { result?: T; error?: { message?: unknown } } | null;
  if (!response.ok || payload?.error) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : `${response.status} ${response.statusText}`.trim();
    throw new Error(`EVM RPC Error: ${message}`);
  }
  if (payload?.result === undefined) {
    throw new Error(`EVM RPC did not return a result for ${method}.`);
  }
  return payload.result;
};

const buildUnsignedEvmTransaction = async (input: {
  rpcUrl: string;
  from: string;
  to: string;
  chainId: number;
  data?: string;
  value?: string;
}): Promise<string> => {
  const request = {
    from: input.from,
    to: input.to,
    value: toRpcQuantity(input.value),
    data: input.data ?? "0x"
  };
  const [nonce, gasPrice, estimatedGas] = await Promise.all([
    rpcCall<string>(input.rpcUrl, "eth_getTransactionCount", [input.from, "pending"]),
    rpcCall<string>(input.rpcUrl, "eth_gasPrice", []),
    rpcCall<string>(input.rpcUrl, "eth_estimateGas", [request])
  ]);
  return serializeTransaction({
    type: "legacy",
    chainId: input.chainId,
    nonce: numberFromRpcQuantity(nonce),
    gasPrice: bigintFromRpcQuantity(gasPrice),
    gas: bigintFromRpcQuantity(estimatedGas),
    to: input.to as `0x${string}`,
    value: bigintFromRpcQuantity(input.value, 0n),
    data: (input.data ?? "0x") as `0x${string}`
  });
};

export function App() {
  const {
    authState,
    handleLogin,
    refreshWallets,
    wallets,
    createWallet,
    signTransaction,
    signAndSendTransaction,
    handleExportWallet,
    handleExportWalletAccount,
    session
  } = useTurnkey();

  const [jwt, setJwt] = useState("");
  const [fundingIntentId, setFundingIntentId] = useState(DEFAULT_INTENT_ID);
  const [routeLegId, setRouteLegId] = useState(DEFAULT_ROUTE_LEG_ID);
  const [intent, setIntent] = useState<FundingIntentResponse | null>(null);
  const [selectedLeg, setSelectedLeg] = useState<FundingRouteLegResponse | null>(null);
  const [txSignature, setTxSignature] = useState("");
  const [createdWalletSummary, setCreatedWalletSummary] = useState("");
  const [step, setStep] = useState<StepState>("idle");
  const [message, setMessage] = useState("Ready.");
  const [rpcUrl, setRpcUrl] = useState(import.meta.env.VITE_SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL);
  const [evmRpcUrl, setEvmRpcUrl] = useState(import.meta.env.VITE_BSC_RPC_URL || DEFAULT_BSC_RPC_URL);

  const requiredSubOrgId = import.meta.env.VITE_TURNKEY_REQUIRED_SUB_ORG_ID || DEFAULT_REQUIRED_SUB_ORG_ID;
  const sessionOrgMatches = session?.organizationId === requiredSubOrgId;
  const turnkeyConfigured = Boolean(import.meta.env.VITE_TURNKEY_ORGANIZATION_ID && import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID);
  const signingKind = routeSigningKind(selectedLeg);

  const matchingAccount = useMemo(
    () => findMatchingRouteAccount(wallets as TurnkeyWalletLike[], intent?.sourceWalletAddress, signingKind),
    [wallets, intent?.sourceWalletAddress, signingKind]
  );
  const matchingWallet = useMemo(
    () => findWalletForAccount(wallets as TurnkeyWalletLike[], matchingAccount),
    [wallets, matchingAccount]
  );

  const canFetch = jwt.trim().length > 0 && fundingIntentId.trim().length > 0;
  const canSign = Boolean(
    selectedLeg?.routeQuote.transactionRequest?.data
    && matchingAccount
    && session
    && sessionOrgMatches
    && jwt.trim()
    && ((signingKind === "EVM" && evmRpcUrl.trim()) || (signingKind === "SOLANA" && rpcUrl.trim()))
  );
  const canExport = Boolean(session && sessionOrgMatches && matchingAccount);
  const signingBlockers = [
    !jwt.trim() ? "Lotus user JWT missing." : null,
    !selectedLeg?.routeQuote.transactionRequest?.data ? "Unsigned transaction missing. Fetch the quoted route first." : null,
    !session ? "Turnkey browser session missing. Click Login." : null,
    session && !sessionOrgMatches ? `Turnkey session org must be ${requiredSubOrgId}.` : null,
    !matchingAccount ? "No Turnkey wallet account matches the funding source address." : null,
    signingKind === "SOLANA" && !rpcUrl.trim() ? "Solana RPC URL missing." : null,
    signingKind === "EVM" && !evmRpcUrl.trim() ? "EVM RPC URL missing." : null
  ].filter((value): value is string => value !== null);

  const fetchIntent = async () => {
    if (!canFetch) {
      setMessage("Paste a Lotus user JWT and funding intent id first.");
      setStep("error");
      return;
    }
    setStep("loading");
    setMessage("Fetching funding intent.");
    setIntent(null);
    setSelectedLeg(null);
    setTxSignature("");
    try {
      const response = await getFundingIntent(jwt.trim(), fundingIntentId.trim());
      const nextLeg = selectPreferredLeg(response, routeLegId);
      if (!nextLeg) {
        throw new Error("Route leg was not found on this funding intent.");
      }
      if (!nextLeg.routeQuote.transactionRequest?.data) {
        throw new Error("Route leg has no unsigned transaction data. Refresh the quote first.");
      }
      setIntent(response);
      setSelectedLeg(nextLeg);
      setMessage("Funding route loaded.");
      setStep("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch funding intent.");
      setStep("error");
    }
  };

  const loginTurnkey = async () => {
    setMessage("Opening Turnkey login.");
    try {
      await handleLogin({ title: "Sign in to Turnkey" });
      await refreshWallets();
      setMessage("Turnkey session ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Turnkey login failed.");
      setStep("error");
    }
  };

  const createCurrentSubOrgWallet = async () => {
    if (!session) {
      setMessage("Turnkey session missing. Click Login first.");
      setStep("error");
      return;
    }
    if (!sessionOrgMatches) {
      setMessage(`Refusing wallet creation outside approved sub-org ${requiredSubOrgId}.`);
      setStep("error");
      return;
    }
    setStep("loading");
    setCreatedWalletSummary("");
    setMessage("Creating Solana and EVM wallet accounts in the approved Turnkey sub-org.");
    try {
      const creator = createWallet as unknown as CreateWallet;
      const result = await creator({
        walletName: "Lotus Test Wallet",
        accounts: ["ADDRESS_FORMAT_SOLANA", "ADDRESS_FORMAT_ETHEREUM"],
        organizationId: requiredSubOrgId
      });
      await refreshWallets({ organizationId: requiredSubOrgId });
      setCreatedWalletSummary(JSON.stringify(result, null, 2));
      setMessage("Wallet creation request completed. Confirm the displayed Solana address before sending funds.");
      setStep("ready");
    } catch (error) {
      console.error("Turnkey wallet creation failed", error);
      setMessage(formatSafeError(error));
      setStep("error");
    }
  };

  const exportMatchedWallet = async () => {
    if (!session || !sessionOrgMatches) {
      setMessage(`Sign into the approved Turnkey sub-org ${requiredSubOrgId} before exporting.`);
      setStep("error");
      return;
    }
    if (!matchingWallet?.walletId) {
      setMessage("Load the route and refresh Turnkey wallets so the matched wallet can be identified.");
      setStep("error");
      return;
    }
    setMessage("Opening Turnkey secure wallet export flow. Lotus will not receive or store the exported key.");
    try {
      const exporter = handleExportWallet as unknown as ExportWallet;
      await exporter({
        walletId: matchingWallet.walletId,
        organizationId: requiredSubOrgId
      });
      setMessage("Turnkey wallet export flow completed or was closed.");
    } catch (error) {
      console.error("Turnkey wallet export failed", error);
      setMessage(formatSafeError(error));
      setStep("error");
    }
  };

  const exportMatchedSolanaAccount = async () => {
    if (!session || !sessionOrgMatches) {
      setMessage(`Sign into the approved Turnkey sub-org ${requiredSubOrgId} before exporting.`);
      setStep("error");
      return;
    }
    if (!matchingAccount?.address) {
      setMessage("Load the route and refresh Turnkey wallets so the matched Solana account can be identified.");
      setStep("error");
      return;
    }
    setMessage("Opening Turnkey secure Solana account export flow. Lotus will not receive or store the exported key.");
    try {
      const exporter = handleExportWalletAccount as unknown as ExportWalletAccount;
      await exporter({
        address: matchingAccount.address,
        keyFormat: KeyFormat.Solana,
        organizationId: requiredSubOrgId
      });
      setMessage("Turnkey Solana account export flow completed or was closed.");
    } catch (error) {
      console.error("Turnkey Solana account export failed", error);
      setMessage(formatSafeError(error));
      setStep("error");
    }
  };

  const signBroadcastAndSubmit = async () => {
    if (!selectedLeg?.routeQuote.transactionRequest?.data || !matchingAccount) {
      setMessage("Load the route and sign into the matching Turnkey wallet first.");
      setStep("error");
      return;
    }
    setStep("signing");
    setMessage("Refreshing quote immediately before signing.");
    setTxSignature("");
    try {
      const refreshed = await quoteFundingIntent(jwt.trim(), fundingIntentId.trim());
      const freshLeg = selectPreferredLeg(refreshed, "");
      if (!freshLeg?.routeQuote.transactionRequest?.data) {
        throw new Error("Fresh quote did not include an unsigned transaction.");
      }
      const freshSigningKind = routeSigningKind(freshLeg);
      const freshMatchingAccount = findMatchingRouteAccount(wallets as TurnkeyWalletLike[], refreshed.sourceWalletAddress, freshSigningKind);
      if (!freshMatchingAccount) {
        throw new Error("No Turnkey wallet account matches the refreshed funding source address.");
      }
      setIntent(refreshed);
      setSelectedLeg(freshLeg);
      setRouteLegId(freshLeg.routeLegId);
      setMessage("Fresh quote loaded. Waiting for Turnkey signature.");
      const transactionRequest = freshLeg.routeQuote.transactionRequest;
      let txHash: string;
      if (freshSigningKind === "EVM") {
        if (!transactionRequest?.to || !transactionRequest.chainId) {
          throw new Error("Direct transfer route is missing EVM transaction fields.");
        }
        const sender = transactionRequest.from ?? freshMatchingAccount.address;
        if (!sender) {
          throw new Error("Direct transfer route is missing the EVM sender address.");
        }
        const signAndSendEvmTransaction = signAndSendTransaction as unknown as SignAndSendTransaction;
        setMessage("Preparing EVM direct transfer for Turnkey signing.");
        const unsignedTransaction = await buildUnsignedEvmTransaction({
          rpcUrl: evmRpcUrl.trim(),
          from: sender,
          to: transactionRequest.to,
          chainId: transactionRequest.chainId,
          value: transactionRequest.value ?? "0",
          data: transactionRequest.data
        });
        setMessage(`Signing and broadcasting EVM direct transfer on ${evmCaip2(transactionRequest.chainId)}.`);
        txHash = await signAndSendEvmTransaction({
          organizationId: session?.organizationId,
          walletAccount: freshMatchingAccount,
          unsignedTransaction,
          transactionType: ETHEREUM_TRANSACTION_TYPE,
          rpcUrl: evmRpcUrl.trim()
        });
      } else {
        const signer = signTransaction as unknown as SignTransaction;
        if (!transactionRequest?.data) {
          throw new Error("Solana route is missing an unsigned transaction.");
        }
        const unsignedTransaction = toTurnkeySolanaUnsignedTransaction(transactionRequest.data);
        const signedTransaction = await signer({
          walletAccount: freshMatchingAccount,
          unsignedTransaction,
          transactionType: SOLANA_TRANSACTION_TYPE,
          organizationId: session?.organizationId
        });
        setMessage("Turnkey signature complete. Broadcasting through Solana RPC.");
        txHash = await broadcastSignedSolanaTransaction(signedTransaction, rpcUrl.trim());
      }
      setTxSignature(txHash);
      setMessage("Broadcast accepted. Submitting tx hash to Lotus.");
      const submitted = await submitFundingTxHash(jwt.trim(), fundingIntentId.trim(), freshLeg.routeLegId, txHash);
      setIntent(submitted);
      setMessage("Funding tx signature submitted to Lotus.");
      setStep("submitted");
    } catch (error) {
      console.error("Signing, broadcast, or Lotus submit failed", error);
      setMessage(formatSafeError(error));
      setStep("error");
    }
  };

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Local funding signer</p>
          <h1 id="page-title">Lotus Turnkey Funding</h1>
        </div>
        <span className={`status status-${step}`}>{step}</span>
      </section>

      {!turnkeyConfigured ? (
        <section className="notice error" role="alert">
          Set `VITE_TURNKEY_ORGANIZATION_ID` and `VITE_TURNKEY_AUTH_PROXY_CONFIG_ID` in `.env.local`.
        </section>
      ) : null}

      <section className="grid">
        <form className="panel" onSubmit={(event) => { event.preventDefault(); void fetchIntent(); }}>
          <h2>Lotus route</h2>
          <label>
            User JWT
            <textarea
              value={jwt}
              onChange={(event) => setJwt(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="Paste short-lived Lotus user JWT"
            />
          </label>
          <label>
            Funding intent id
            <input
              value={fundingIntentId}
              onChange={(event) => setFundingIntentId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Route leg id
            <input
              value={routeLegId}
              onChange={(event) => setRouteLegId(event.target.value)}
              autoComplete="off"
            />
          </label>
          {signingKind === "SOLANA" ? (
            <label>
              Solana RPC URL
              <input
                value={rpcUrl}
                onChange={(event) => setRpcUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          {signingKind === "EVM" ? (
            <label>
              EVM RPC URL
              <input
                value={evmRpcUrl}
                onChange={(event) => setEvmRpcUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          <button type="submit" disabled={!canFetch || step === "loading"}>
            {step === "loading" ? "Loading" : "Fetch route"}
          </button>
        </form>

        <section className="panel">
          <h2>Turnkey session</h2>
          <dl>
            <div>
              <dt>Auth</dt>
              <dd>{authState ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Session org</dt>
              <dd>{session?.organizationId ?? "not signed in"}</dd>
            </div>
            <div>
              <dt>Required org</dt>
              <dd>{requiredSubOrgId}</dd>
            </div>
            <div>
              <dt>Wallets</dt>
              <dd>{wallets.length}</dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" onClick={() => void loginTurnkey()}>
              Login
            </button>
            <button type="button" onClick={() => void refreshWallets()} disabled={!session}>
              Refresh
            </button>
            <button type="button" onClick={() => void createCurrentSubOrgWallet()} disabled={!session || !sessionOrgMatches}>
              Create wallet
            </button>
          </div>
        </section>
      </section>

      <section className="panel">
        <h2>Signing check</h2>
        <dl className="details">
          <div>
            <dt>Signing path</dt>
            <dd>{signingKind === "UNKNOWN" ? "route not loaded" : signingKind === "EVM" ? "EVM direct transfer" : "Solana transaction"}</dd>
          </div>
          <div>
            <dt>Source wallet</dt>
            <dd>{intent?.sourceWalletAddress ?? "route not loaded"}</dd>
          </div>
          <div>
            <dt>Matched account</dt>
            <dd>{matchingAccount?.address ?? "none"}</dd>
          </div>
          <div>
            <dt>Matched wallet</dt>
            <dd>{matchingWallet?.walletId ?? "none"}</dd>
          </div>
          <div>
            <dt>Detected accounts</dt>
            <dd>{(wallets as TurnkeyWalletLike[]).flatMap((wallet) => wallet.accounts ?? []).length}</dd>
          </div>
          <div>
            <dt>Quote status</dt>
            <dd>{selectedLeg?.status ?? "none"}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>
              {selectedLeg
                ? `${selectedLeg.destinationAmountEstimate} ${selectedLeg.destinationToken} on ${selectedLeg.destinationChain}`
                : "none"}
            </dd>
          </div>
          {signingKind === "SOLANA" ? (
            <div>
              <dt>RPC</dt>
              <dd>{rpcUrl}</dd>
            </div>
          ) : null}
          {signingKind === "EVM" ? (
            <div>
              <dt>EVM RPC</dt>
              <dd>{evmRpcUrl}</dd>
            </div>
          ) : null}
        </dl>
        {signingBlockers.length > 0 ? (
          <div className="blockers" role="status" aria-live="polite">
            <strong>Signing blockers</strong>
            <ul>
              {signingBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {(wallets as TurnkeyWalletLike[]).length > 0 ? (
          <details className="wallet-debug">
            <summary>Detected Turnkey accounts</summary>
            <ul>
              {(wallets as TurnkeyWalletLike[]).flatMap((wallet) => wallet.accounts ?? []).map((account, index) => (
                <li key={`${account.walletAccountId ?? account.address ?? "account"}-${index}`}>
                  <code>{account.address ?? "unknown address"}</code>
                  <span>{account.addressFormat ?? "unknown format"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <button type="button" className="primary" onClick={() => void signBroadcastAndSubmit()} disabled={!canSign || step === "signing"}>
          {step === "signing" ? "Signing" : "Sign, broadcast, submit"}
        </button>
      </section>

      <section className="panel danger-panel">
        <h2>Wallet export</h2>
        <p>
          Use this only to recover funds from the current Turnkey test wallet. Export happens inside Turnkey's secure flow;
          Lotus does not receive, display, log, or store private key material.
        </p>
        <dl className="details">
          <div>
            <dt>Export org</dt>
            <dd>{session?.organizationId ?? "not signed in"}</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd>{matchingWallet?.walletId ?? "load route first"}</dd>
          </div>
          <div>
            <dt>Solana account</dt>
            <dd>{matchingAccount?.address ?? "load route first"}</dd>
          </div>
          <div>
            <dt>Guardrail</dt>
            <dd>{sessionOrgMatches ? "approved test sub-org" : "blocked outside approved test sub-org"}</dd>
          </div>
        </dl>
        <div className="actions">
          <button type="button" className="danger" onClick={() => void exportMatchedSolanaAccount()} disabled={!canExport}>
            Export matched Solana account
          </button>
          <button type="button" onClick={() => void exportMatchedWallet()} disabled={!canExport || !matchingWallet?.walletId}>
            Export matched wallet
          </button>
        </div>
      </section>

      <section className={`notice ${step === "error" ? "error" : ""}`} aria-live="polite">
        {message}
      </section>

      {txSignature ? (
        <section className="panel">
          <h2>Transaction signature</h2>
          <code>{txSignature}</code>
        </section>
      ) : null}

      {createdWalletSummary ? (
        <section className="panel">
          <h2>Created wallet response</h2>
          <code>{createdWalletSummary}</code>
        </section>
      ) : null}
    </main>
  );
}

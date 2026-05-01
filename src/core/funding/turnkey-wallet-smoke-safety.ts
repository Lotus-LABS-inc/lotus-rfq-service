const forbiddenKeyPatterns = [
  /private[-_]?key/i,
  /api[-_]?key/i,
  /^seed$/i,
  /seed[-_]?phrase/i,
  /^token$/i,
  /auth/i,
  /secret/i,
  /provider[-_]?sub[-_]?org[-_]?id/i,
  /provider[-_]?wallet[-_]?id/i,
  /provider[-_]?wallet[-_]?account[-_]?id/i,
  /export[-_]?bundle/i,
  /sign[-_]?with/i
];

const allowedWalletKeys = new Set([
  "walletId",
  "provider",
  "chainFamily",
  "chain",
  "address",
  "purpose",
  "venue",
  "exportable",
  "status",
  "createdAt",
  "updatedAt"
]);

export interface SecretScanResult {
  passed: boolean;
  findings: string[];
}

export interface SafeWalletSummary {
  walletId: string | null;
  provider: string | null;
  chainFamily: string | null;
  chain: string | null;
  address: string | null;
  purpose: string | null;
  venue: string | null;
  exportable: boolean | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export const scanForTurnkeySmokeSecrets = (value: unknown, path = "$"): SecretScanResult => {
  const findings = findForbiddenKeys(value, path);
  return {
    passed: findings.length === 0,
    findings
  };
};

export const summarizeSafeWallet = (value: unknown): SafeWalletSummary => {
  const wallet = isRecord(value) ? value : {};
  return {
    walletId: stringOrNull(wallet.walletId),
    provider: stringOrNull(wallet.provider),
    chainFamily: stringOrNull(wallet.chainFamily),
    chain: stringOrNull(wallet.chain),
    address: stringOrNull(wallet.address),
    purpose: stringOrNull(wallet.purpose),
    venue: stringOrNull(wallet.venue),
    exportable: typeof wallet.exportable === "boolean" ? wallet.exportable : null,
    status: stringOrNull(wallet.status),
    createdAt: stringOrNull(wallet.createdAt),
    updatedAt: stringOrNull(wallet.updatedAt)
  };
};

export const findUnexpectedWalletKeys = (wallets: unknown[]): string[] => {
  const findings: string[] = [];
  wallets.forEach((wallet, index) => {
    if (!isRecord(wallet)) {
      findings.push(`wallets[${index}]`);
      return;
    }
    for (const key of Object.keys(wallet)) {
      if (!allowedWalletKeys.has(key)) {
        findings.push(`wallets[${index}].${key}`);
      }
    }
  });
  return findings;
};

const findForbiddenKeys = (value: unknown, path: string): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    return [];
  }

  const findings: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isForbiddenKey(key) && child !== null && child !== undefined && String(child).length > 0) {
      findings.push(childPath);
      continue;
    }
    findings.push(...findForbiddenKeys(child, childPath));
  }
  return findings;
};

const isForbiddenKey = (key: string): boolean =>
  forbiddenKeyPatterns.some((pattern) => pattern.test(key));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

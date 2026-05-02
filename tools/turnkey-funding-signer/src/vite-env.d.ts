/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOTUS_API_BASE_URL?: string;
  readonly VITE_TURNKEY_ORGANIZATION_ID?: string;
  readonly VITE_TURNKEY_AUTH_PROXY_CONFIG_ID?: string;
  readonly VITE_TURNKEY_REQUIRED_SUB_ORG_ID?: string;
  readonly VITE_TURNKEY_API_BASE_URL?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_BSC_RPC_URL?: string;
  readonly VITE_STANDALONE_BRIDGE_SOURCE_TOKEN_ADDRESS?: string;
  readonly VITE_STANDALONE_BRIDGE_SOURCE_TOKEN_SYMBOL?: string;
  readonly VITE_STANDALONE_BRIDGE_SOURCE_DECIMALS?: string;
  readonly VITE_STANDALONE_BRIDGE_DESTINATION_TOKEN_ADDRESS?: string;
  readonly VITE_STANDALONE_BRIDGE_DESTINATION_TOKEN_SYMBOL?: string;
  readonly VITE_STANDALONE_BRIDGE_DESTINATION_DECIMALS?: string;
  readonly VITE_STANDALONE_BRIDGE_SOURCE_AMOUNT?: string;
  readonly VITE_STANDALONE_BRIDGE_SOURCE_WALLET?: string;
  readonly VITE_STANDALONE_BRIDGE_DESTINATION_WALLET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  };
}

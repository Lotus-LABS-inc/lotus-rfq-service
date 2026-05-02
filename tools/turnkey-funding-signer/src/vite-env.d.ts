/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOTUS_API_BASE_URL?: string;
  readonly VITE_TURNKEY_ORGANIZATION_ID?: string;
  readonly VITE_TURNKEY_AUTH_PROXY_CONFIG_ID?: string;
  readonly VITE_TURNKEY_REQUIRED_SUB_ORG_ID?: string;
  readonly VITE_TURNKEY_API_BASE_URL?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

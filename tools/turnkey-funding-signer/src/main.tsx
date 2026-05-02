import "@turnkey/react-wallet-kit/styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { TurnkeyProvider, type TurnkeyProviderConfig } from "@turnkey/react-wallet-kit";
import { App } from "./App";
import "./styles.css";

const turnkeyConfig: TurnkeyProviderConfig = {
  organizationId: import.meta.env.VITE_TURNKEY_ORGANIZATION_ID ?? "",
  authProxyConfigId: import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID ?? "",
  apiBaseUrl: import.meta.env.VITE_TURNKEY_API_BASE_URL || "https://api.turnkey.com",
  ui: {
    darkMode: true,
    preferLargeActionButtons: true
  },
  auth: {
    methods: {
      emailOtpAuthEnabled: true,
      passkeyAuthEnabled: true,
      walletAuthEnabled: false,
      smsOtpAuthEnabled: false
    },
    methodOrder: ["email", "passkey"]
  }
};

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element is missing.");
}

createRoot(root).render(
  <React.StrictMode>
    <TurnkeyProvider
      config={turnkeyConfig}
      callbacks={{
        onError: (error) => {
          console.error("Turnkey error", error);
        }
      }}
    >
      <App />
    </TurnkeyProvider>
  </React.StrictMode>
);

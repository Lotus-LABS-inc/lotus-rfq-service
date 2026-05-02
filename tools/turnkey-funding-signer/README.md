# Lotus Turnkey Funding Signer

Local-only operator page for signing a Lotus funding route with the user's Turnkey browser session.

This app does not use backend Turnkey credentials, does not export keys, and does not ask the backend to sign. It fetches a quoted funding route, signs and broadcasts the LI.FI Solana transaction through Turnkey Wallet Kit in the browser, then submits the resulting Solana signature to Lotus.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill:
   - `VITE_TURNKEY_ORGANIZATION_ID`
   - `VITE_TURNKEY_AUTH_PROXY_CONFIG_ID`
   - `VITE_TURNKEY_REQUIRED_SUB_ORG_ID=94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb`
   - `VITE_SOLANA_RPC_URL`
3. Run:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5177`.

Use a short-lived Lotus user JWT for the same user who owns the funding intent.

## Canonical Test Identity

For funding tests that require an email-backed Turnkey user, use:

```text
polymarket-funding-test@uselotus.xyz
```

Do not create new funded smoke wallets with alternate test emails unless the Turnkey dashboard confirms that email has an embedded Solana wallet and can sign in through Wallet Kit. A Lotus JWT email only controls Lotus API access; the Turnkey login email must also resolve to the sub-organization that owns the funded wallet.

For current email-backed tests, the only approved Turnkey sub-organization is:

```text
94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb
```

The signer refuses to sign if Wallet Kit authenticates into any other sub-organization.

## Current Polymarket Test Values

- Funding intent: `14a65f3c-2165-4101-9e4e-7ea437a32a46`
- Route leg: `c5d7216e-8dff-4910-ae3c-7e6505dd6ec1`
- Source address: `DhZs33FsdP6JiuKjqfiQx9E4jNauHPq63ehUVePZXLRi`

After the transaction broadcasts, the app calls:

```http
POST /funding/intents/:fundingIntentId/submit
```

with the `routeLegId` and Solana transaction signature.

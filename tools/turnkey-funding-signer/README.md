# Lotus Turnkey Funding Signer

Local-only operator page for signing a Lotus funding route with the user's Turnkey browser session.

This app does not use backend Turnkey credentials, does not export keys, and does not ask the backend to sign. It fetches a quoted funding route, signs with the user's Turnkey browser session, broadcasts through the user-side wallet flow, then submits the resulting transaction hash/signature to Lotus.

Supported route types:

- LI.FI Solana routes: signs the unsigned Solana transaction and broadcasts through the configured Solana RPC.
- Direct same-chain EVM routes, including BNB/BSC USDT: builds a normal EVM transaction, signs it through Turnkey Wallet Kit, broadcasts through the configured EVM RPC, and records the returned transaction hash. This avoids Turnkey's optional `ethSendTransaction` feature.
- Standalone LI.FI bridge-back routes for already-withdrawn funds, currently used for BSC USDT -> Solana USDC recovery/exit testing without creating fake Lotus withdrawal records.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill:
   - `VITE_TURNKEY_ORGANIZATION_ID`
   - `VITE_TURNKEY_AUTH_PROXY_CONFIG_ID`
   - `VITE_TURNKEY_REQUIRED_SUB_ORG_ID=94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb`
   - `VITE_SOLANA_RPC_URL` for Solana routes only
   - `VITE_BSC_RPC_URL` for BNB/BSC direct-transfer and standalone bridge routes
   - optional `VITE_STANDALONE_BRIDGE_SOURCE_AMOUNT`, `VITE_STANDALONE_BRIDGE_SOURCE_WALLET`, and `VITE_STANDALONE_BRIDGE_DESTINATION_WALLET`
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

## Funding Route Values

Paste the funding intent id and route leg id from the current live smoke. The app intentionally does not ship stale default route IDs.

After the transaction broadcasts, the app calls:

```http
POST /funding/intents/:fundingIntentId/submit
```

with the `routeLegId` and transaction hash/signature.

## Standalone Bridge-Back

Use `Standalone bridge-back` only when funds have already exited a venue to the user's EVM wallet and should be bridged back to the approved Solana wallet. This mode fetches a LI.FI quote, signs and broadcasts from the user's Turnkey wallet, and does not submit anything to Lotus backend accounting.

LI.FI currently rejects Solana USDT for this route, so the default exit path is BSC USDT -> Solana USDC.

Current default bridge:

```text
BSC USDT from 0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa
to Solana USDC at A5K7uttgW2TPPd9dce6cxgdbAwDkKR7gEsopFDYZGooc
```

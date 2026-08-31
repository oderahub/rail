"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";

export const somniaShannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } },
  blockExplorers: { default: { name: "Shannon", url: "https://shannon-explorer.somnia.network" } },
  testnet: true,
});

/**
 * Somnia runs Privy GLOBAL WALLETS: one wallet carried across every app in the
 * ecosystem. Listing Somnia's provider app id means someone who already trades
 * on dreamDEX arrives here with the same address and the same balance, rather
 * than being asked to adopt yet another wallet.
 */
const SOMNIA_PROVIDER_APP_ID = "privy:cm8d9yzp2013kkr612h8ymoq8";

/**
 * Integrating another app's global wallet requires the Privy app to be in
 * production, which is a paid tier. Off by default: without it users still get
 * an embedded wallet, they just don't arrive with the dreamDEX address they
 * already fund. Set NEXT_PUBLIC_SOMNIA_GLOBAL_WALLET=1 once the app is upgraded.
 */
const useGlobalWallet = process.env.NEXT_PUBLIC_SOMNIA_GLOBAL_WALLET === "1";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return (
      <main className="wrap">
        <h1>Rail</h1>
        <p className="muted">
          Missing <code>NEXT_PUBLIC_PRIVY_APP_ID</code>. Create an app at privy.io, enable
          Somnia's global wallet under User&nbsp;Management → Global&nbsp;Wallet → Integrations,
          and put the id in <code>.env</code>.
        </p>
      </main>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Only list methods actually enabled on the Privy app. A method listed
        // here but disabled in the dashboard renders a button that silently
        // does nothing — which is indistinguishable from a broken app.
        loginMethods: [
          "email",
          ...(process.env.NEXT_PUBLIC_GOOGLE_LOGIN === "1" ? ["google"] : []),
          ...(useGlobalWallet ? [SOMNIA_PROVIDER_APP_ID] : []),
        ] as any,
        appearance: { theme: "dark", accentColor: "#C2701A", logo: undefined },
        supportedChains: [somniaShannon],
        defaultChain: somniaShannon,
        embeddedWallets: { createOnLogin: "users-without-wallets" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

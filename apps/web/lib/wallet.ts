"use client";

import {
  allowAllModules,
  FREIGHTER_ID,
  StellarWalletsKit,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_PASSPHRASE ?? "Test SDF Network ; September 2015";

let _kit: StellarWalletsKit | null = null;

export function kit(): StellarWalletsKit {
  if (typeof window === "undefined") {
    throw new Error("wallet kit accessed on the server");
  }
  if (!_kit) {
    _kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return _kit;
}

/** Pop the wallet picker and resolve the connected address. */
export async function connectWallet(): Promise<string> {
  const k = kit();
  return await new Promise<string>((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          if (!address) throw new Error("wallet returned no address");
          window.localStorage.setItem("mirofish:wallet", option.id);
          window.localStorage.setItem("mirofish:operator", address);
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
      onClosed: (err) => {
        if (err) reject(err);
        else reject(new Error("wallet selection cancelled"));
      },
    });
  });
}

/** Reconnect to the last-used wallet (call on mount). */
export async function resumeWallet(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const id = window.localStorage.getItem("mirofish:wallet");
  const cached = window.localStorage.getItem("mirofish:operator");
  if (!id || !cached) return null;
  try {
    const k = kit();
    k.setWallet(id);
    const { address } = await k.getAddress();
    if (address) {
      window.localStorage.setItem("mirofish:operator", address);
      return address;
    }
  } catch {
    /* user uninstalled the extension or revoked */
  }
  return cached;
}

export function disconnectWallet(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("mirofish:wallet");
  window.localStorage.removeItem("mirofish:operator");
}

/** Ask the connected wallet to sign a Soroban tx XDR. */
export async function signXdr(xdr: string, address: string): Promise<string> {
  const k = kit();
  const { signedTxXdr } = await k.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (!signedTxXdr) throw new Error("wallet returned no signed tx");
  return signedTxXdr;
}

export { NETWORK_PASSPHRASE };

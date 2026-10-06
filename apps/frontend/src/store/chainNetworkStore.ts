import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which chain THIS person is looking at.
 *
 * A viewer preference, not a deployment setting. The sysop pointing Pools at
 * testnet must not drag everyone else's Explorer along - and equally, someone
 * exploring testnet should not have their choice reset because the server is
 * serving mainnet to everybody else.
 *
 * Persisted per browser, and always reset to mainnet when the choice cannot be
 * honoured: absent, unrecognised, or testnet on a deployment with no testnet
 * configured. Mainnet is the absence of a signal, which is the conservative
 * reading and matches how the backend resolves the same question.
 */
export type ChainNetwork = 'mainnet' | 'testnet';

interface ChainNetworkState {
  network: ChainNetwork;
  /** False until the server says a testnet base URL exists. */
  testnetAvailable: boolean;
  setNetwork: (n: ChainNetwork) => void;
  setTestnetAvailable: (v: boolean) => void;
}

export const useChainNetworkStore = create<ChainNetworkState>()(
  persist(
    (set) => ({
      network: 'mainnet',
      testnetAvailable: false,
      setNetwork: (network) => set({ network }),
      setTestnetAvailable: (testnetAvailable) => set((s) => ({
        testnetAvailable,
        // A stored preference for a chain this deployment no longer serves
        // would fail every lookup and look like the data had vanished.
        network: testnetAvailable ? s.network : 'mainnet',
      })),
    }),
    { name: 'zec-os-chain-network' },
  ),
);

/** Append the caller's chosen network to a chain-data URL. */
export function withNetwork(url: string, network: ChainNetwork): string {
  if (network !== 'testnet') return url;
  return `${url}${url.includes('?') ? '&' : '?'}net=testnet`;
}

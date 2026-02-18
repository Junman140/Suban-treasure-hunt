import { useCallback } from 'react';
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { Networks } from '@creit-tech/stellar-wallets-kit/types';
import type { WalletError } from '@stellar/stellar-sdk/contract';
import { useWalletStore } from '../store/walletSlice';
import { devWalletService, DevWalletService } from '../services/devWalletService';
import { embeddedWalletService } from '../services/embeddedWalletService';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';

const WALLET_ID = 'stellar-wallets-kit';
let kitInitialized = false;

function toWalletError(error?: { message: string; code: number }): WalletError | undefined {
  if (!error) return undefined;
  return { message: error.message, code: error.code };
}

function resolveNetwork(passphrase?: string): Networks {
  if (passphrase && Object.values(Networks).includes(passphrase as Networks)) {
    return passphrase as Networks;
  }
  return NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

function ensureKitInitialized(passphrase?: string) {
  if (typeof window === 'undefined') return;
  if (!kitInitialized) {
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: resolveNetwork(passphrase),
    });
    kitInitialized = true;
    return;
  }
  if (passphrase) {
    StellarWalletsKit.setNetwork(resolveNetwork(passphrase));
  }
}

export function useWallet() {
  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    setWallet,
    setConnecting,
    setNetwork,
    setError,
    disconnect: storeDisconnect,
  } = useWalletStore();

  /**
   * Connect as a dev player (for testing)
   * DEV MODE ONLY - Not used in production
   */
  const connectDev = useCallback(
    async (playerNumber: 1 | 2) => {
      try {
        setConnecting(true);
        setError(null);

        await devWalletService.initPlayer(playerNumber);
        const address = devWalletService.getPublicKey();

        // Update store with dev wallet
        setWallet(address, `dev-player${playerNumber}`, 'dev');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to connect dev wallet';
        setError(errorMessage);
        console.error('Dev wallet connection error:', err);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [setWallet, setConnecting, setNetwork, setError]
  );

  /**
   * Switch between dev players
   * DEV MODE ONLY - Not used in production
   */
  const switchPlayer = useCallback(
    async (playerNumber: 1 | 2) => {
      if (walletType !== 'dev') {
        throw new Error('Can only switch players in dev mode');
      }

      try {
        setConnecting(true);
        setError(null);

        await devWalletService.switchPlayer(playerNumber);
        const address = devWalletService.getPublicKey();

        // Update store with new player
        setWallet(address, `dev-player${playerNumber}`, 'dev');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch player';
        setError(errorMessage);
        console.error('Player switch error:', err);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [walletType, setWallet, setConnecting, setError]
  );

  /**
   * Connect with Stellar Wallets Kit (Freighter or other supported wallet)
   */
  const connectWallet = useCallback(async () => {
    if (typeof window === 'undefined') {
      setError('Wallet connection is only available in the browser.');
      return;
    }
    try {
      setConnecting(true);
      setError(null);
      ensureKitInitialized(NETWORK_PASSPHRASE);
      const { address } = await StellarWalletsKit.authModal();
      if (typeof address !== 'string' || !address) {
        throw new Error('No wallet address returned');
      }
      setWallet(address, WALLET_ID, 'wallet');
      setNetwork(NETWORK, NETWORK_PASSPHRASE);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      console.error('Wallet connection error:', err);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setWallet, setConnecting, setError, setNetwork]);

  /**
   * Connect with embedded wallet (user-provided secret in sessionStorage, signs in-browser)
   */
  const connectEmbedded = useCallback(
    async (secret: string) => {
      if (typeof window === 'undefined') {
        setError('Embedded wallet is only available in the browser.');
        return;
      }
      try {
        setConnecting(true);
        setError(null);
        const trimmed = secret.trim();
        if (!trimmed) throw new Error('Secret key is required');
        embeddedWalletService.setSecret(trimmed);
        const address = embeddedWalletService.getPublicKey();
        setWallet(address, 'embedded', 'embedded');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid secret key';
        setError(message);
        console.error('Embedded wallet connection error:', err);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [setWallet, setConnecting, setError, setNetwork]
  );

  /**
   * Disconnect wallet
   */
  const disconnect = useCallback(async () => {
    if (walletType === 'dev') {
      devWalletService.disconnect();
    }
    if (walletType === 'embedded') {
      embeddedWalletService.clear();
    }
    storeDisconnect();
  }, [walletType, storeDisconnect]);

  /**
   * Get a signer for contract interactions
   * Returns functions that the Stellar SDK TS bindings can use for signing
   */
  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey || !walletType) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'dev') {
      return devWalletService.getSigner();
    }

    if (walletType === 'embedded') {
      return embeddedWalletService.getSigner();
    }

    // Stellar Wallets Kit (Freighter, etc.)
    const passphrase = networkPassphrase || NETWORK_PASSPHRASE;
    return {
      signTransaction: async (
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
      ) => {
        try {
          ensureKitInitialized(opts?.networkPassphrase || passphrase);
          const result = await StellarWalletsKit.signTransaction(xdr, {
            networkPassphrase: opts?.networkPassphrase || passphrase,
            address: opts?.address || publicKey,
            submit: opts?.submit,
            submitUrl: opts?.submitUrl,
          });
          return {
            signedTxXdr: result.signedTxXdr || xdr,
            signerAddress: result.signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign transaction';
          return {
            signedTxXdr: xdr,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },
      signAuthEntry: async (authEntry: string, opts?: { networkPassphrase?: string; address?: string }) => {
        try {
          ensureKitInitialized(opts?.networkPassphrase || passphrase);
          const result = await StellarWalletsKit.signAuthEntry(authEntry, {
            networkPassphrase: opts?.networkPassphrase || passphrase,
            address: opts?.address || publicKey,
          });
          return {
            signedAuthEntry: result.signedAuthEntry || authEntry,
            signerAddress: result.signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign auth entry';
          return {
            signedAuthEntry: authEntry,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },
    };
  }, [isConnected, publicKey, walletType, networkPassphrase]);

  /**
   * Check if dev mode is available
   */
  const isDevModeAvailable = useCallback(() => {
    return DevWalletService.isDevModeAvailable();
  }, []);

  /**
   * Check if a specific dev player is available
   */
  const isDevPlayerAvailable = useCallback((playerNumber: 1 | 2) => {
    return DevWalletService.isPlayerAvailable(playerNumber);
  }, []);

  /**
   * Get current dev player number
   */
  const getCurrentDevPlayer = useCallback(() => {
    if (walletType !== 'dev') {
      return null;
    }
    return devWalletService.getCurrentPlayer();
  }, [walletType]);

  return {
    // State
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,

    // Actions
    connectDev,
    connectWallet,
    connectEmbedded,
    switchPlayer,
    disconnect,
    getContractSigner,
    isDevModeAvailable,
    isDevPlayerAvailable,
    getCurrentDevPlayer,
  };
}

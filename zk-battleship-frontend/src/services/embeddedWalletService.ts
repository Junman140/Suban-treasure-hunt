import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

const LOCAL_STORAGE_KEY = 'stellar-local-wallet-secret';

/**
 * Local wallet: keypair stored in localStorage, signing in-browser.
 * Avoids repeated wallet confirmations for games with many contract interactions.
 * - Create: generate new keypair with Stellar SDK, store secret in localStorage.
 * - Import: user-provided secret, validated and stored in localStorage.
 * For session-limited keys or smart-account session keys, see smart accounts:
 * https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account
 */
class EmbeddedWalletService {
  /**
   * Check if a secret is stored (persists across sessions)
   */
  hasStoredSecret(): boolean {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem(LOCAL_STORAGE_KEY);
  }

  /**
   * Generate a new keypair and store in localStorage (no user confirmations for signing)
   */
  generateAndStore(): string {
    if (typeof window === 'undefined') {
      throw new Error('Local wallet is only available in the browser.');
    }
    const keypair = Keypair.random();
    const secret = keypair.secret();
    localStorage.setItem(LOCAL_STORAGE_KEY, secret);
    return keypair.publicKey();
  }

  /**
   * Set the user-provided secret key (validates and stores in localStorage)
   */
  setSecret(secret: string): void {
    Keypair.fromSecret(secret);
    if (typeof window === 'undefined') {
      throw new Error('Local wallet is only available in the browser.');
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, secret.trim());
  }

  /**
   * Get public key for the stored secret
   */
  getPublicKey(): string {
    const secret = this.getStoredSecret();
    const keypair = Keypair.fromSecret(secret);
    return keypair.publicKey();
  }

  private getStoredSecret(): string {
    if (typeof window === 'undefined') {
      throw new Error('Local wallet is only available in the browser.');
    }
    const secret = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!secret) {
      throw new Error('No local wallet secret stored.');
    }
    return secret;
  }

  /**
   * Clear the stored secret from localStorage (e.g. "Clear saved wallet")
   */
  clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  /**
   * Get a signer that signs transactions and auth entries in-browser using the stored key
   */
  getSigner(): ContractSigner {
    const secret = this.getStoredSecret();
    const keypair = Keypair.fromSecret(secret);
    const publicKey = keypair.publicKey();
    const toWalletError = (message: string): WalletError => ({ message, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        try {
          if (!opts?.networkPassphrase) {
            throw new Error('Missing networkPassphrase');
          }
          const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          transaction.sign(keypair);
          return {
            signedTxXdr: transaction.toXDR(),
            signerAddress: publicKey,
          };
        } catch (error) {
          return {
            signedTxXdr: txXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign transaction'
            ),
          };
        }
      },

      signAuthEntry: async (preimageXdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        try {
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const signatureBytes = keypair.sign(payload);
          return {
            signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
            signerAddress: publicKey,
          };
        } catch (error) {
          return {
            signedAuthEntry: preimageXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign auth entry'
            ),
          };
        }
      },
    };
  }
}

export const embeddedWalletService = new EmbeddedWalletService();
export { EmbeddedWalletService };

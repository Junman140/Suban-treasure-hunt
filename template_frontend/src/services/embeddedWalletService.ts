import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

const SESSION_STORAGE_KEY = 'stellar-embedded-wallet-secret';

/**
 * Embedded wallet: user-provided secret key in sessionStorage,
 * keypair derived locally, signing in-browser. Session-only (cleared when tab closes).
 */
class EmbeddedWalletService {
  hasStoredSecret(): boolean {
    if (typeof window === 'undefined') return false;
    return !!sessionStorage.getItem(SESSION_STORAGE_KEY);
  }

  setSecret(secret: string): void {
    Keypair.fromSecret(secret);
    if (typeof window === 'undefined') {
      throw new Error('Embedded wallet is only available in the browser.');
    }
    sessionStorage.setItem(SESSION_STORAGE_KEY, secret);
  }

  getPublicKey(): string {
    const secret = this.getStoredSecret();
    const keypair = Keypair.fromSecret(secret);
    return keypair.publicKey();
  }

  private getStoredSecret(): string {
    if (typeof window === 'undefined') {
      throw new Error('Embedded wallet is only available in the browser.');
    }
    const secret = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!secret) {
      throw new Error('No embedded wallet secret in session.');
    }
    return secret;
  }

  clear(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }

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

      signAuthEntry: async (preimageXdr: string) => {
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

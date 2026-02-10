import {
  Client as ZkBattleshipClient,
  type Game,
  type Shot,
} from './bindings';
import {
  NETWORK_PASSPHRASE,
  RPC_URL,
  DEFAULT_METHOD_OPTIONS,
  DEFAULT_AUTH_TTL_MINUTES,
  MULTI_SIG_AUTH_TTL_MINUTES,
} from '@/utils/constants';
import {
  contract,
  TransactionBuilder,
  xdr,
  Address,
  authorizeEntry,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

type ClientOptions = contract.ClientOptions;

export type TreasurePlacement = {
  x: number;
  y: number;
};

/** Generate 32-byte commitment from treasure placements (5 cells, sorted by x*10+y) */
export function generateCommitment(treasures: TreasurePlacement[]): Buffer {
  const canonical = treasures
    .sort((a, b) => a.x * 10 + a.y - (b.x * 10 + b.y))
    .map((t) => `${t.x},${t.y}`)
    .join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  let hash = 0n;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5n) - hash + BigInt(data[i])) & 0xffffffffffffffffn;
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64BE(hash ^ BigInt(i * 0x11111111), i * 8);
  }
  return out;
}

export class ZkBattleshipService {
  private baseClient: ZkBattleshipClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new ZkBattleshipClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): ZkBattleshipClient {
    return new ZkBattleshipClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    });
  }

  async getGame(sessionId: number): Promise<Game | null> {
    try {
      const tx = await this.baseClient.get_game({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap();
      }
      return null;
    } catch {
      return null;
    }
  }

  async prepareStartGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    player1Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const buildClient = new ZkBattleshipClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });

    const tx = await buildClient.start_game(
      {
        session_id: sessionId,
        player1,
        player2,
        player1_points: player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS
    );

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    let player1AuthEntry = null;
    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
        if (addr === player1) {
          player1AuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1`);
    }

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry not available');
    }

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        const signResult = await player1Signer.signAuthEntry!(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: player1,
        });
        if (signResult.error) throw new Error(signResult.error.message);
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );
    return signedAuthEntry.toXDR('base64');
  }

  parseAuthEntry(authEntryXdr: string): {
    sessionId: number;
    player1: string;
    player1Points: bigint;
  } {
    const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
    const addr = authEntry.credentials().address().address();
    const player1 = Address.fromScAddress(addr).toString();
    const fn = authEntry.rootInvocation().function().contractFn();
    const args = fn.args();
    const sessionId = args[0].u32();
    const player1Points = args[1].i128().lo().toBigInt();
    return { sessionId, player1, player1Points };
  }

  async importAndSignAuthEntry(
    player1SignedAuthEntryXdr: string,
    player2Address: string,
    player2Points: bigint,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const gameParams = this.parseAuthEntry(player1SignedAuthEntryXdr);
    if (player2Address === gameParams.player1) {
      throw new Error('Cannot play against yourself');
    }

    const buildClient = new ZkBattleshipClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address,
    });

    const tx = await buildClient.start_game(
      {
        session_id: gameParams.sessionId,
        player1: gameParams.player1,
        player2: player2Address,
        player1_points: gameParams.player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS
    );

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    const txWithInjectedAuth = await injectSignedAuthEntry(
      tx,
      player1SignedAuthEntryXdr,
      player2Address,
      player2Signer,
      validUntilLedgerSeq
    );

    const player2Client = this.createSigningClient(player2Address, player2Signer);
    const player2Tx = player2Client.txFromXDR(txWithInjectedAuth.toXDR());
    const needsSigning = await player2Tx.needsNonInvokerSigningBy();
    if (needsSigning.includes(player2Address)) {
      await player2Tx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }
    return player2Tx.toXDR();
  }

  async finalizeStartGame(
    xdr: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(xdr);
    await tx.simulate();
    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      DEFAULT_AUTH_TTL_MINUTES
    );
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  async commitBoard(
    sessionId: number,
    player: string,
    commitment: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.commit_board(
      { session_id: sessionId, player, commitment },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      DEFAULT_AUTH_TTL_MINUTES
    );
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  async fireShot(
    sessionId: number,
    player: string,
    x: number,
    y: number,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.fire_shot(
      { session_id: sessionId, player, x, y },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      DEFAULT_AUTH_TTL_MINUTES
    );
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  async respondShot(
    sessionId: number,
    player: string,
    hit: boolean,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.respond_shot(
      { session_id: sessionId, player, hit },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      DEFAULT_AUTH_TTL_MINUTES
    );
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }
}

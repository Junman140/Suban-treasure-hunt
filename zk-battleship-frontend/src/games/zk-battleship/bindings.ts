import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i128,
  Option,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  (window as unknown as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

export interface Game {
  commitment1: Option<Buffer>;
  commitment2: Option<Buffer>;
  current_turn: u32;
  level: Option<u32>;
  max_shots_per_player: Option<u32>;
  pending_shot: Option<Array<u32>>;
  phase: GamePhase;
  player1: string;
  player1_points: i128;
  player2: string;
  player2_points: i128;
  shots_by_player1: Array<Shot>;
  shots_by_player2: Array<Shot>;
  sudden_death: Option<boolean>;
  target_hits: Option<u32>;
  turn_deadline_ledger: Option<u32>;
  turn_timeout_ledgers: Option<u32>;
  winner: Option<string>;
}

export interface Shot {
  hit: boolean;
  x: u32;
  y: u32;
}

export const Errors = {
  1: { message: "GameNotFound" },
  2: { message: "NotPlayer" },
  3: { message: "GameAlreadyEnded" },
  4: { message: "InvalidPhase" },
  5: { message: "NotYourTurn" },
  6: { message: "AlreadyCommitted" },
  7: { message: "CommitmentRequired" },
  8: { message: "InvalidCoordinate" },
  9: { message: "ShotAlreadyFired" },
  10: { message: "PendingResponse" },
};

export type DataKey =
  | { tag: "Game"; values: readonly [u32] }
  | { tag: "GameHubAddress"; values: void }
  | { tag: "Admin"; values: void };

export enum GamePhase {
  WaitingCommits = 0,
  Active = 1,
  Finished = 2,
}

export interface Client {
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
  set_hub: (
    { new_hub }: { new_hub: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<null>>;
  upgrade: (
    { new_wasm_hash }: { new_wasm_hash: Buffer },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<null>>;
  get_game: (
    { session_id }: { session_id: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<Game>>>;
  fire_shot: (
    {
      session_id,
      player,
      x,
      y,
    }: { session_id: u32; player: string; x: u32; y: u32 },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
  set_admin: (
    { new_admin }: { new_admin: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<null>>;
  start_game: (
    {
      session_id,
      player1,
      player2,
      player1_points,
      player2_points,
    }: {
      session_id: u32;
      player1: string;
      player2: string;
      player1_points: i128;
      player2_points: i128;
    },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
  start_game_v2: (
    {
      session_id,
      player1,
      player2,
      player1_points,
      player2_points,
      level,
    }: {
      session_id: u32;
      player1: string;
      player2: string;
      player1_points: i128;
      player2_points: i128;
      level: u32;
    },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
  commit_board: (
    {
      session_id,
      player,
      commitment,
    }: { session_id: u32; player: string; commitment: Buffer },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
  respond_shot: (
    {
      session_id,
      player,
      hit,
    }: { session_id: u32; player: string; hit: boolean },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
  claim_timeout_win: (
    { session_id, claimant }: { session_id: u32; claimant: string },
    options?: MethodOptions
  ) => Promise<AssembledTransaction<Result<void>>>;
}

const CONTRACT_SPEC = new ContractSpec([
  "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAASAAAAAAAAAAtjb21taXRtZW50MQAAAAPoAAAD7gAAACAAAAAAAAAAC2NvbW1pdG1lbnQyAAAAA+gAAAPuAAAAIAAAAAAAAAAMY3VycmVudF90dXJuAAAABAAAAAAAAAAFbGV2ZWwAAAAAAAPoAAAABAAAAAAAAAAUbWF4X3Nob3RzX3Blcl9wbGF5ZXIAAAPoAAAABAAAAAAAAAAMcGVuZGluZ19zaG90AAAD6AAAA+oAAAAEAAAAAAAAAAVwaGFzZQAAAAAAB9AAAAAJR2FtZVBoYXNlAAAAAAAAAAAAAAdwbGF5ZXIxAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjJfcG9pbnRzAAAAAAALAAAAAAAAABBzaG90c19ieV9wbGF5ZXIxAAAD6gAAB9AAAAAEU2hvdAAAAAAAAAAQc2hvdHNfYnlfcGxheWVyMgAAA+oAAAfQAAAABFNob3QAAAAAAAAADHN1ZGRlbl9kZWF0aAAAA+gAAAABAAAAAAAAAAt0YXJnZXRfaGl0cwAAAAPoAAAABAAAAAAAAAAUdHVybl9kZWFkbGluZV9sZWRnZXIAAAPoAAAABAAAAAAAAAAUdHVybl90aW1lb3V0X2xlZGdlcnMAAAPoAAAABAAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
  "AAAAAQAAAAAAAAAAAAAABFNob3QAAAADAAAAAAAAAANoaXQAAAAAAQAAAAAAAAABeAAAAAAAAAQAAAAAAAAAAXkAAAAAAAAE",
  "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACgAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAMAAAAAAAAADEludmFsaWRQaGFzZQAAAAQAAAAAAAAAC05vdFlvdXJUdXJuAAAAAAUAAAAAAAAAEEFscmVhZHlDb21taXR0ZWQAAAAGAAAAAAAAABJDb21taXRtZW50UmVxdWlyZWQAAAAAAAcAAAAAAAAAEUludmFsaWRDb29yZGluYXRlAAAAAAAACAAAAAAAAAAQU2hvdEFscmVhZHlGaXJlZAAAAAkAAAAAAAAAD1BlbmRpbmdSZXNwb25zZQAAAAAK",
  "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAA==",
  "AAAAAwAAAAAAAAAAAAAACUdhbWVQaGFzZQAAAAAAAAMAAAAAAAAADldhaXRpbmdDb21taXRzAAAAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAEAAAAAAAAACEZpbmlzaGVkAAAAAg==",
  "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
  "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
  "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
  "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
  "AAAAAAAAAEFGaXJlIGEgc2hvdCBhdCAoeCwgeSkuIENvb3JkaW5hdGVzIDAtOS4gQ3VycmVudCBwbGF5ZXIgbXVzdCBmaXJlLgAAAAAAAAlmaXJlX3Nob3QAAAAAAAAEAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAAAXgAAAAAAAAEAAAAAAAAAAF5AAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
  "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
  "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
  "AAAAAAAAAFdTdGFydCBhIG5ldyBnYW1lLiBCb3RoIHBsYXllcnMgbXVzdCB0aGVuIGNhbGwgY29tbWl0X2JvYXJkIHdpdGggdGhlaXIgYm9hcmQgY29tbWl0bWVudC4AAAAACnN0YXJ0X2dhbWUAAAAAAAUAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
  "AAAAAAAAAKZDb21taXQgYm9hcmQuIFBsYXllciBzdWJtaXRzIGEgMzItYnl0ZSBjb21taXRtZW50IChoYXNoIG9mIHNoaXAgcGxhY2VtZW50KS4KUHJvb2YgdmVyaWZpY2F0aW9uIChCTjI1NC9Qb3NlaWRvbikgY2FuIGJlIGFkZGVkIHdoZW4gUHJvdG9jb2wgMjUgaG9zdCBmdW5jdGlvbnMgYXJlIHVzZWQuAAAAAAAMY29tbWl0X2JvYXJkAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
  "AAAAAAAAAIdSZXNwb25kIHRvIHRoZSBwZW5kaW5nIHNob3Qgd2l0aCBoaXQgKHRydWUpIG9yIG1pc3MgKGZhbHNlKS4KRGVmZW5kZXIgbXVzdCByZXNwb25kLiBaSyBwcm9vZiB2ZXJpZmljYXRpb24gY2FuIGJlIGFkZGVkIGZvciBQcm90b2NvbCAyNS4AAAAADHJlc3BvbmRfc2hvdAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAADaGl0AAAAAAEAAAABAAAD6QAAAAIAAAAD",
  "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
  "AAAAAAAAAGpTdGFydCBhIG5ldyBnYW1lIHdpdGggbGV2ZWwgKDEgPSBRdWljayBIdW50LCAyID0gQ2xhc3NpYyBUaW1lZCkuIEJvdGggcGxheWVycyBtdXN0IHRoZW4gY2FsbCBjb21taXRfYm9hcmQuAAAAAAANc3RhcnRfZ2FtZV92MgAAAAAAAAYAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAAAAAAABWxldmVsAAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
  "AAAAAAAAAFJDbGFpbSB3aW4gd2hlbiB0aGUgb3Bwb25lbnQgdGltZWQgb3V0IChsZWRnZXIgc2VxdWVuY2UgcGFzdCB0dXJuX2RlYWRsaW5lX2xlZGdlcikuAAAAAAARY2xhaW1fdGltZW91dF93aW4AAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhjbGFpbWFudAAAABMAAAABAAAD6QAAAAIAAAAD",
]);

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(CONTRACT_SPEC, options);
  }
}

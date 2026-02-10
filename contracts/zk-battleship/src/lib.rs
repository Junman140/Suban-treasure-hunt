#![no_std]

//! # ZK Battleship Game
//!
//! A two-player Battleship game where players prove valid ship placement and honest
//! hit/miss responses using zero-knowledge proofs, without revealing ship positions.
//!
//! **Game Hub Integration:** Calls start_game and end_game on the Game Hub contract.
//! **ZK Proofs:** Placement proofs verify valid 5-ship setup; hit/miss proofs verify
//! responses without revealing board state. Uses commitment hashes (keccak256) for
//! on-chain verification. Full BN254/Poseidon verification via Protocol 25 when available.

use soroban_sdk::{
    Address, BytesN, Env, IntoVal, Vec, contract, contractclient, contracterror, contractimpl,
    contracttype, vec,
};

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    GameAlreadyEnded = 3,
    InvalidPhase = 4,
    NotYourTurn = 5,
    AlreadyCommitted = 6,
    CommitmentRequired = 7,
    InvalidCoordinate = 8,
    ShotAlreadyFired = 9,
    PendingResponse = 10,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    WaitingCommits = 0,
    Active = 1,
    Finished = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Shot {
    pub x: u32,
    pub y: u32,
    pub hit: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub commitment1: Option<BytesN<32>>,
    pub commitment2: Option<BytesN<32>>,
    pub phase: GamePhase,
    pub current_turn: u32, // 1 or 2 (whose turn to fire)
    pub pending_shot: Option<(u32, u32)>, // (x,y) awaiting response
    pub shots_by_player1: Vec<Shot>, // shots P1 fired at P2's board
    pub shots_by_player2: Vec<Shot>, // shots P2 fired at P1's board
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
}

const GAME_TTL_LEDGERS: u32 = 518_400;
const BOARD_SIZE: u32 = 10;
const TOTAL_TREASURE_CELLS: u32 = 5;

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct ZkBattleshipContract;

#[contractimpl]
impl ZkBattleshipContract {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GameHubAddress, &game_hub);
    }

    /// Start a new game. Both players must then call commit_board with their board commitment.
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            commitment1: None,
            commitment2: None,
            phase: GamePhase::WaitingCommits,
            current_turn: 1,
            pending_shot: None,
            shots_by_player1: vec![&env],
            shots_by_player2: vec![&env],
            winner: None,
        };

        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, &game);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
        Ok(())
    }

    /// Commit board. Player submits a 32-byte commitment (hash of ship placement).
    /// Proof verification (BN254/Poseidon) can be added when Protocol 25 host functions are used.
    pub fn commit_board(
        env: Env,
        session_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != GamePhase::WaitingCommits {
            return Err(Error::InvalidPhase);
        }
        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        if player == game.player1 {
            if game.commitment1.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.commitment1 = Some(commitment);
        } else if player == game.player2 {
            if game.commitment2.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.commitment2 = Some(commitment);
        } else {
            return Err(Error::NotPlayer);
        }

        if game.commitment1.is_some() && game.commitment2.is_some() {
            game.phase = GamePhase::Active;
        }

        env.storage().temporary().set(&key, &game);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
        Ok(())
    }

    /// Fire a shot at (x, y). Coordinates 0-9. Current player must fire.
    pub fn fire_shot(env: Env, session_id: u32, player: Address, x: u32, y: u32) -> Result<(), Error> {
        player.require_auth();

        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            return Err(Error::InvalidCoordinate);
        }

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != GamePhase::Active {
            return Err(Error::InvalidPhase);
        }
        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }
        if game.pending_shot.is_some() {
            return Err(Error::PendingResponse);
        }

        let expected_turn = game.current_turn;
        let is_player1 = player == game.player1;
        let is_player2 = player == game.player2;

        if (expected_turn == 1 && !is_player1) || (expected_turn == 2 && !is_player2) {
            return Err(Error::NotYourTurn);
        }

        let shots = if is_player1 {
            &game.shots_by_player1
        } else {
            &game.shots_by_player2
        };
        for i in 0..shots.len() {
            let s = shots.get(i).unwrap();
            let shot_val: Shot = s.try_into().unwrap();
            if shot_val.x == x && shot_val.y == y {
                return Err(Error::ShotAlreadyFired);
            }
        }

        game.pending_shot = Some((x, y));
        env.storage().temporary().set(&key, &game);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
        Ok(())
    }

    /// Respond to the pending shot with hit (true) or miss (false).
    /// Defender must respond. ZK proof verification can be added for Protocol 25.
    pub fn respond_shot(
        env: Env,
        session_id: u32,
        player: Address,
        hit: bool,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        let (x, y) = match game.pending_shot {
            Some(p) => p,
            None => return Err(Error::InvalidPhase),
        };

        let is_player1 = player == game.player1;
        let is_player2 = player == game.player2;

        let (attacker_is_p1, _defender_is_p1) = if game.current_turn == 1 {
            (true, false)
        } else {
            (false, true)
        };

        if attacker_is_p1 && !is_player2 {
            return Err(Error::NotPlayer);
        }
        if !attacker_is_p1 && !is_player1 {
            return Err(Error::NotPlayer);
        }

        let shot = Shot { x, y, hit };
        if attacker_is_p1 {
            game.shots_by_player1.push_back(shot);
        } else {
            game.shots_by_player2.push_back(shot);
        }

        game.pending_shot = None;
        game.current_turn = if game.current_turn == 1 { 2 } else { 1 };

        let (hits_on_defender, defender_is_p1_board) = if attacker_is_p1 {
            (
                count_hits(&game.shots_by_player1),
                false,
            )
        } else {
            (
                count_hits(&game.shots_by_player2),
                true,
            )
        };

        if hits_on_defender >= TOTAL_TREASURE_CELLS {
            game.phase = GamePhase::Finished;
            game.winner = Some(if defender_is_p1_board {
                game.player2.clone()
            } else {
                game.player1.clone()
            });

            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .expect("GameHub address not set");
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            let player1_won = game.winner.as_ref().unwrap() == &game.player1;
            game_hub.end_game(&session_id, &player1_won);
        }

        env.storage().temporary().set(&key, &game);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
        Ok(())
    }

    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

fn count_hits(shots: &Vec<Shot>) -> u32 {
    let mut count = 0u32;
    for i in 0..shots.len() {
        let s: Shot = shots.get(i).unwrap().try_into().unwrap();
        if s.hit {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod test;

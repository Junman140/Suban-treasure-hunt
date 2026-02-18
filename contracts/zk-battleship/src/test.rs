#![cfg(test)]

use crate::{ZkBattleshipContract, ZkBattleshipContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
}

fn setup_test() -> (
    Env,
    ZkBattleshipContractClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register_contract(None, MockGameHub);
    let admin = Address::generate(&env);
    let contract_id = env.register(ZkBattleshipContract, (&admin, &hub_addr));
    let client = ZkBattleshipContractClient::new(&env, &contract_id);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    (env, client, player1, player2)
}

#[test]
fn test_start_and_commit() {
    let (_env, client, player1, player2) = setup_test();
    let session_id = 1u32;
    let points = 100_0000000i128;
    let commitment = BytesN::from_array(&_env, &[1u8; 32]);

    client.start_game(&session_id, &player1, &player2, &points, &points);
    client.commit_board(&session_id, &player1, &commitment);
    client.commit_board(&session_id, &player2, &commitment);

    let game = client.get_game(&session_id);
    assert!(game.commitment1.is_some());
    assert!(game.commitment2.is_some());
}

#[test]
fn test_fire_and_respond() {
    let (_env, client, player1, player2) = setup_test();
    let session_id = 2u32;
    let points = 100_0000000i128;
    let commitment = BytesN::from_array(&_env, &[2u8; 32]);

    client.start_game(&session_id, &player1, &player2, &points, &points);
    client.commit_board(&session_id, &player1, &commitment);
    client.commit_board(&session_id, &player2, &commitment);

    client.fire_shot(&session_id, &player1, &0, &0);
    client.respond_shot(&session_id, &player2, &false);

    let game = client.get_game(&session_id);
    assert_eq!(game.shots_by_player1.len(), 1);
}

#[test]
fn level1_target_hits_3_ends_early() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 10u32;
    let points = 100_0000000i128;
    let commitment = BytesN::from_array(&env, &[10u8; 32]);

    client.start_game_v2(&session_id, &player1, &player2, &points, &points, &1u32);
    client.commit_board(&session_id, &player1, &commitment);
    client.commit_board(&session_id, &player2, &commitment);

    let game = client.get_game(&session_id);
    assert_eq!(game.target_hits, Some(3));

    // P1 fires three hits on P2's board; alternate with P2's turns so turn order is correct
    client.fire_shot(&session_id, &player1, &0, &0);
    client.respond_shot(&session_id, &player2, &true);
    client.fire_shot(&session_id, &player2, &0, &1);
    client.respond_shot(&session_id, &player1, &false);
    client.fire_shot(&session_id, &player1, &1, &0);
    client.respond_shot(&session_id, &player2, &true);
    client.fire_shot(&session_id, &player2, &1, &1);
    client.respond_shot(&session_id, &player1, &false);
    client.fire_shot(&session_id, &player1, &2, &0);
    client.respond_shot(&session_id, &player2, &true);

    let game = client.get_game(&session_id);
    assert!(game.winner.is_some());
    assert_eq!(game.winner, Some(player1.clone()));
}

#[test]
fn level2_timeout_claim_works() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 20u32;
    let points = 100_0000000i128;
    let commitment = BytesN::from_array(&env, &[20u8; 32]);

    client.start_game_v2(&session_id, &player1, &player2, &points, &points, &2u32);
    client.commit_board(&session_id, &player1, &commitment);
    client.commit_board(&session_id, &player2, &commitment);

    client.fire_shot(&session_id, &player1, &0, &0);
    // Defender (player2) does not respond; advance ledger past deadline
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600 + 1000,
        protocol_version: 25,
        sequence_number: 100 + 150, // past 100 + 120
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    client.claim_timeout_win(&session_id, &player1);
    let game = client.get_game(&session_id);
    assert!(game.winner.is_some());
    assert_eq!(game.winner, Some(player1.clone()));
}

#[test]
fn level1_cap_tie_enters_sudden_death() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 30u32;
    let points = 100_0000000i128;
    let commitment = BytesN::from_array(&env, &[30u8; 32]);

    client.start_game_v2(&session_id, &player1, &player2, &points, &points, &1u32);
    client.commit_board(&session_id, &player1, &commitment);
    client.commit_board(&session_id, &player2, &commitment);

    // Level 1: max 20 shots per player. Alternate turns until both at 20 shots with tied hits (2 each)
    // Board is 10x10 so use (i % 10, i / 10) for valid coords
    for i in 0u32..20 {
        let x1 = i % 10;
        let y1 = i / 10;
        client.fire_shot(&session_id, &player1, &x1, &y1);
        client.respond_shot(&session_id, &player2, &(i < 2)); // 2 hits for P1
        client.fire_shot(&session_id, &player2, &x1, &y1);
        client.respond_shot(&session_id, &player1, &(i < 2)); // 2 hits for P2
    }

    let game = client.get_game(&session_id);
    assert!(game.sudden_death == Some(true), "should be in sudden death after cap tie");

    // First hit in sudden death ends the game: P1 fires at a cell not yet tried, P2 responds hit -> P1 wins
    client.fire_shot(&session_id, &player1, &0, &2);
    client.respond_shot(&session_id, &player2, &true);

    let game = client.get_game(&session_id);
    assert!(game.winner.is_some());
    assert_eq!(game.winner, Some(player1.clone()));
}

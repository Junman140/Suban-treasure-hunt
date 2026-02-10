#![cfg(test)]

use crate::{Error, ZkBattleshipContract, ZkBattleshipContractClient};
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

    let game = client.get_game(&session_id).unwrap();
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

    let game = client.get_game(&session_id).unwrap();
    assert_eq!(game.shots_by_player1.len(), 1);
}

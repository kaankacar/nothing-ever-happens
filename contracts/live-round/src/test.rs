#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, BytesN as _, Ledger as _};
use soroban_sdk::{Bytes, BytesN, Env};

const A: u32 = 0;
const B: u32 = 1;

fn sha256_choice_nonce(env: &Env, c: u32, nonce: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    let byte = match c {
        0 => b'A',
        1 => b'B',
        2 => b'C',
        3 => b'D',
        _ => 0,
    };
    buf.push_back(byte);
    buf.append(&nonce.clone().into());
    env.crypto().sha256(&buf).to_bytes()
}

fn setup(env: &Env) -> (Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let oracle_pk = BytesN::<32>::random(env);
    let contract_id = env.register(LiveRound, ());
    let client = LiveRoundClient::new(env, &contract_id);
    client.init(&admin, &oracle_pk, &1000i128, &3u32);
    (admin, contract_id)
}

#[test]
fn register_commit_reveal_credits_operator() {
    let env = Env::default();
    let (admin, contract_id) = setup(&env);
    let client = LiveRoundClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let question_hash = BytesN::<32>::random(&env);
    let rid = client.open_round(&admin, &question_hash, &100u32, &1_180u64, &1_300u64);
    assert_eq!(rid, 1);

    let operator = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.register_agent(&operator, &delegate);

    let nonce = BytesN::<32>::random(&env);
    let commit = sha256_choice_nonce(&env, B, &nonce);
    client.commit(&rid, &delegate, &commit);

    env.ledger().with_mut(|l| l.timestamp = 1_200);
    client.reveal(&rid, &delegate, &B, &nonce);

    let round = client.get_round(&rid);
    assert!(matches!(round.state, RoundState::Sealed));

    // Reputation lookup follows operator, not delegate.
    let op_rep_before = client.reputation_of(&operator);
    let del_rep_before = client.reputation_of(&delegate);
    assert_eq!(op_rep_before, 0);
    assert_eq!(del_rep_before, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn unregistered_delegate_cannot_commit() {
    let env = Env::default();
    let (admin, contract_id) = setup(&env);
    let client = LiveRoundClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let question_hash = BytesN::<32>::random(&env);
    let rid = client.open_round(&admin, &question_hash, &100u32, &1_180u64, &1_300u64);

    let delegate = Address::generate(&env);
    let nonce = BytesN::<32>::random(&env);
    let commit = sha256_choice_nonce(&env, A, &nonce);
    client.commit(&rid, &delegate, &commit);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn delegate_cannot_be_bound_twice() {
    let env = Env::default();
    let (_admin, contract_id) = setup(&env);
    let client = LiveRoundClient::new(&env, &contract_id);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.register_agent(&op1, &delegate);
    client.register_agent(&op2, &delegate);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn reveal_with_wrong_nonce_fails() {
    let env = Env::default();
    let (admin, contract_id) = setup(&env);
    let client = LiveRoundClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let question_hash = BytesN::<32>::random(&env);
    let rid = client.open_round(&admin, &question_hash, &100u32, &1_180u64, &1_300u64);

    let operator = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.register_agent(&operator, &delegate);

    let real_nonce = BytesN::<32>::random(&env);
    let commit = sha256_choice_nonce(&env, A, &real_nonce);
    client.commit(&rid, &delegate, &commit);

    env.ledger().with_mut(|l| l.timestamp = 1_200);
    let fake_nonce = BytesN::<32>::random(&env);
    client.reveal(&rid, &delegate, &A, &fake_nonce);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn commit_after_close_fails() {
    let env = Env::default();
    let (admin, contract_id) = setup(&env);
    let client = LiveRoundClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let question_hash = BytesN::<32>::random(&env);
    let rid = client.open_round(&admin, &question_hash, &100u32, &1_180u64, &1_300u64);

    let operator = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.register_agent(&operator, &delegate);

    env.ledger().with_mut(|l| l.timestamp = 1_300);
    let nonce = BytesN::<32>::random(&env);
    let commit = sha256_choice_nonce(&env, B, &nonce);
    client.commit(&rid, &delegate, &commit);
}

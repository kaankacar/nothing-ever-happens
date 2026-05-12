//! LiveRound — the on-chain heart of the MiroFish Arena.
//!
//! Two-key model:
//!   - `operator`  the user's wallet (Freighter / passkey / hardware). Owns
//!                 the agent and receives soulbound reputation.
//!   - `delegate`  a runner-custodied Stellar key. Authorized by the operator
//!                 at registration time; signs the high-frequency commit /
//!                 reveal transactions so the user doesn't have to pop a
//!                 wallet prompt every five minutes.
//!
//! Lifecycle per round:
//!   register_agent (operator)  — one-time; binds delegate → operator
//!   open_round    (admin)
//!   commit        (delegate)   — SHA256(answer || nonce) before close_ts
//!   reveal        (delegate)   — answer + nonce, after seed ledger closes
//!   settle        (admin)      — signed verdict; reputation goes to operator
//!
//! Choices A/B/C/D are encoded as u32 values 0..3. The commit hash uses the
//! ASCII byte of the choice ('A' = 0x41, etc.) so off-chain and on-chain agree
//! byte-for-byte.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, panic_with_error,
    Address, Bytes, BytesN, Env, Vec,
};

mod events;
use events::{AgentRegistered, Committed, Opened, Revealed, Settled};

// ---------- Storage keys ----------

const ORACLE: &str = "oracle";
const ADMIN: &str = "admin";
const NEXT_RID: &str = "next_rid";
const REP_POOL: &str = "rep_pool";
const TOP_N: &str = "top_n";

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Round metadata keyed by round id.
    Round(u32),
    /// Agent record keyed by operator address.
    Agent(Address),
    /// Reverse map: delegate → operator, for fast lookup at commit time.
    DelegateOf(Address),
    /// Commitment hash keyed by (round_id, delegate).
    Commit(u32, Address),
    /// Reveal record keyed by (round_id, delegate).
    Reveal(u32, Address),
    /// Soulbound reputation balance keyed by operator.
    Reputation(Address),
    /// Per-round delegate list (used for iteration on settle).
    Committers(u32),
    /// Per-round reveal list, ordered by reveal time.
    Revealers(u32),
    /// Winners after settle.
    Winners(u32),
}

// ---------- Domain types ----------

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RoundState {
    Commit,
    Sealed,
    Settled,
}

/// Sentinel meaning "no verdict yet" in `Round.verdict`. Real values are 0..=3.
pub const VERDICT_UNSET: u32 = 255;

fn choice_byte(c: u32) -> u8 {
    match c {
        0 => b'A',
        1 => b'B',
        2 => b'C',
        3 => b'D',
        _ => 0,
    }
}

#[contracttype]
#[derive(Clone)]
pub struct Round {
    pub id: u32,
    pub question_hash: BytesN<32>,
    pub seed_ledger: u32,
    pub close_ts: u64,
    pub reveal_close_ts: u64,
    pub state: RoundState,
    /// Verdict choice index 0..3; VERDICT_UNSET (255) before settle.
    pub verdict: u32,
    /// Resolution seed (ledger close hash). All-zeros before settle.
    pub seed: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentRecord {
    pub operator: Address,
    pub delegate: Address,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct RevealRecord {
    pub delegate: Address,
    pub choice: u32,
    pub nonce: BytesN<32>,
    pub revealed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct WinnerRecord {
    pub operator: Address,
    pub delegate: Address,
    pub rank: u32,
    pub reputation_delta: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    RoundNotFound = 4,
    RoundWrongState = 5,
    CommitClosed = 6,
    RevealClosed = 7,
    AlreadyCommitted = 8,
    AlreadyRevealed = 9,
    NoCommit = 10,
    HashMismatch = 11,
    InvalidArgument = 13,
    InvalidChoice = 14,
    NotRegistered = 15,
    AlreadyRegistered = 16,
    DelegateInUse = 17,
}

// ---------- Contract ----------

#[contract]
pub struct LiveRound;

#[contractimpl]
impl LiveRound {
    pub fn init(env: Env, admin: Address, oracle_pk: BytesN<32>, rep_pool: i128, top_n: u32) {
        let s = env.storage().instance();
        if s.has(&ADMIN) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        s.set(&ADMIN, &admin);
        s.set(&ORACLE, &oracle_pk);
        s.set(&REP_POOL, &rep_pool);
        s.set(&TOP_N, &top_n);
        s.set(&NEXT_RID, &1u32);
    }

    /// Bind a delegate key to an operator. Operator must sign this call. Each
    /// delegate can only be bound once; an operator can re-register (e.g.
    /// rotate the delegate) only after `unregister_agent`.
    pub fn register_agent(env: Env, operator: Address, delegate: Address) {
        operator.require_auth();
        if env.storage().persistent().has(&DataKey::Agent(operator.clone())) {
            panic_with_error!(&env, Error::AlreadyRegistered);
        }
        if env.storage().persistent().has(&DataKey::DelegateOf(delegate.clone())) {
            panic_with_error!(&env, Error::DelegateInUse);
        }
        let record = AgentRecord {
            operator: operator.clone(),
            delegate: delegate.clone(),
            registered_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Agent(operator.clone()), &record);
        env.storage()
            .persistent()
            .set(&DataKey::DelegateOf(delegate.clone()), &operator);
        AgentRegistered { operator, delegate }.publish(&env);
    }

    /// Operator-initiated delegate rotation: drop the existing binding so a
    /// new `register_agent` can bind a fresh delegate.
    pub fn unregister_agent(env: Env, operator: Address) {
        operator.require_auth();
        let record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(operator.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotRegistered));
        env.storage().persistent().remove(&DataKey::Agent(operator));
        env.storage()
            .persistent()
            .remove(&DataKey::DelegateOf(record.delegate));
    }

    pub fn open_round(
        env: Env,
        admin: Address,
        question_hash: BytesN<32>,
        seed_ledger: u32,
        close_ts: u64,
        reveal_close_ts: u64,
    ) -> u32 {
        Self::require_admin(&env, &admin);
        if close_ts >= reveal_close_ts {
            panic_with_error!(&env, Error::InvalidArgument);
        }
        let rid: u32 = env.storage().instance().get(&NEXT_RID).unwrap_or(1);
        let zero_seed = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let round = Round {
            id: rid,
            question_hash: question_hash.clone(),
            seed_ledger,
            close_ts,
            reveal_close_ts,
            state: RoundState::Commit,
            verdict: VERDICT_UNSET,
            seed: zero_seed,
        };
        env.storage().persistent().set(&DataKey::Round(rid), &round);
        env.storage()
            .persistent()
            .set(&DataKey::Committers(rid), &Vec::<Address>::new(&env));
        env.storage()
            .persistent()
            .set(&DataKey::Revealers(rid), &Vec::<RevealRecord>::new(&env));
        env.storage().instance().set(&NEXT_RID, &(rid + 1));
        Opened {
            round_id: rid,
            question_hash,
            seed_ledger,
            close_ts,
            reveal_close_ts,
        }
        .publish(&env);
        rid
    }

    /// Delegate commits SHA-256(ascii_choice_byte || nonce). Delegate must be
    /// registered to an operator (see `register_agent`).
    pub fn commit(env: Env, round_id: u32, delegate: Address, commit_hash: BytesN<32>) {
        delegate.require_auth();
        let _operator = Self::operator_of(&env, &delegate);
        let mut round = Self::load_round(&env, round_id);
        if !matches!(round.state, RoundState::Commit) {
            panic_with_error!(&env, Error::RoundWrongState);
        }
        if env.ledger().timestamp() > round.close_ts {
            round.state = RoundState::Sealed;
            env.storage().persistent().set(&DataKey::Round(round_id), &round);
            panic_with_error!(&env, Error::CommitClosed);
        }
        let key = DataKey::Commit(round_id, delegate.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyCommitted);
        }
        env.storage().persistent().set(&key, &commit_hash);

        let mut committers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Committers(round_id))
            .unwrap_or_else(|| Vec::new(&env));
        committers.push_back(delegate.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Committers(round_id), &committers);

        Committed { round_id, delegate, commit_hash }.publish(&env);
    }

    pub fn reveal(env: Env, round_id: u32, delegate: Address, choice: u32, nonce: BytesN<32>) {
        delegate.require_auth();
        if choice > 3 {
            panic_with_error!(&env, Error::InvalidChoice);
        }
        let _operator = Self::operator_of(&env, &delegate);
        let mut round = Self::load_round(&env, round_id);
        let now = env.ledger().timestamp();
        if now <= round.close_ts {
            panic_with_error!(&env, Error::RoundWrongState);
        }
        if now > round.reveal_close_ts {
            panic_with_error!(&env, Error::RevealClosed);
        }
        if matches!(round.state, RoundState::Commit) {
            round.state = RoundState::Sealed;
            env.storage().persistent().set(&DataKey::Round(round_id), &round);
        }
        if !matches!(round.state, RoundState::Sealed) {
            panic_with_error!(&env, Error::RoundWrongState);
        }

        let commit_key = DataKey::Commit(round_id, delegate.clone());
        let commit_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&commit_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoCommit));

        let reveal_key = DataKey::Reveal(round_id, delegate.clone());
        if env.storage().persistent().has(&reveal_key) {
            panic_with_error!(&env, Error::AlreadyRevealed);
        }

        let mut buf = Bytes::new(&env);
        buf.push_back(choice_byte(choice));
        buf.append(&nonce.clone().into());
        let computed = env.crypto().sha256(&buf);
        if computed.to_bytes() != commit_hash {
            panic_with_error!(&env, Error::HashMismatch);
        }

        let record = RevealRecord {
            delegate: delegate.clone(),
            choice,
            nonce: nonce.clone(),
            revealed_at: now,
        };
        env.storage().persistent().set(&reveal_key, &record);

        let mut revealers: Vec<RevealRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Revealers(round_id))
            .unwrap_or_else(|| Vec::new(&env));
        revealers.push_back(record);
        env.storage()
            .persistent()
            .set(&DataKey::Revealers(round_id), &revealers);

        Revealed { round_id, delegate, choice, nonce }.publish(&env);
    }

    pub fn settle(
        env: Env,
        round_id: u32,
        verdict: u32,
        seed: BytesN<32>,
        verdict_sig: BytesN<64>,
    ) {
        if verdict > 3 {
            panic_with_error!(&env, Error::InvalidChoice);
        }
        let mut round = Self::load_round(&env, round_id);
        let now = env.ledger().timestamp();
        if matches!(round.state, RoundState::Settled) {
            panic_with_error!(&env, Error::RoundWrongState);
        }
        if now <= round.reveal_close_ts {
            panic_with_error!(&env, Error::RoundWrongState);
        }

        let mut payload = Bytes::new(&env);
        for b in round_id.to_le_bytes().iter() {
            payload.push_back(*b);
        }
        payload.append(&round.question_hash.clone().into());
        payload.append(&seed.clone().into());
        payload.push_back(choice_byte(verdict));

        let oracle_pk: BytesN<32> = env
            .storage()
            .instance()
            .get(&ORACLE)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        env.crypto().ed25519_verify(&oracle_pk, &payload, &verdict_sig);

        round.state = RoundState::Settled;
        round.verdict = verdict;
        round.seed = seed.clone();
        env.storage().persistent().set(&DataKey::Round(round_id), &round);

        let revealers: Vec<RevealRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Revealers(round_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut winners: Vec<WinnerRecord> = Vec::new(&env);
        let top_n: u32 = env.storage().instance().get(&TOP_N).unwrap_or(3);
        let rep_pool: i128 = env.storage().instance().get(&REP_POOL).unwrap_or(0);

        let mut correct_delegates: Vec<Address> = Vec::new(&env);
        for r in revealers.iter() {
            if r.choice == verdict {
                correct_delegates.push_back(r.delegate.clone());
                if correct_delegates.len() >= top_n {
                    break;
                }
            }
        }

        let weights: [i128; 3] = [50, 30, 20];
        let mut idx: usize = 0;
        for delegate in correct_delegates.iter() {
            let w = weights.get(idx).copied().unwrap_or(0);
            let delta = rep_pool * w / 100;
            // Credit the operator, not the delegate.
            let operator: Address = env
                .storage()
                .persistent()
                .get(&DataKey::DelegateOf(delegate.clone()))
                .unwrap_or_else(|| panic_with_error!(&env, Error::NotRegistered));
            if delta > 0 {
                Self::add_reputation(&env, &operator, delta);
            }
            winners.push_back(WinnerRecord {
                operator: operator.clone(),
                delegate: delegate.clone(),
                rank: (idx as u32) + 1,
                reputation_delta: delta,
            });
            idx += 1;
        }
        env.storage()
            .persistent()
            .set(&DataKey::Winners(round_id), &winners);

        let winners_count = winners.len() as u32;
        Settled {
            round_id,
            verdict,
            seed,
            winners: winners_count,
        }
        .publish(&env);
    }

    pub fn get_round(env: Env, round_id: u32) -> Round {
        Self::load_round(&env, round_id)
    }

    pub fn reputation_of(env: Env, operator: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(operator))
            .unwrap_or(0)
    }

    pub fn agent_of(env: Env, operator: Address) -> AgentRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(operator))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotRegistered))
    }

    pub fn operator_for_delegate(env: Env, delegate: Address) -> Address {
        Self::operator_of(&env, &delegate)
    }

    pub fn winners(env: Env, round_id: u32) -> Vec<WinnerRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Winners(round_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn rotate_oracle(env: Env, admin: Address, new_oracle_pk: BytesN<32>) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&ORACLE, &new_oracle_pk);
    }

    // ---------- Internal helpers ----------

    fn load_round(env: &Env, round_id: u32) -> Round {
        env.storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .unwrap_or_else(|| panic_with_error!(env, Error::RoundNotFound))
    }

    fn operator_of(env: &Env, delegate: &Address) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::DelegateOf(delegate.clone()))
            .unwrap_or_else(|| panic_with_error!(env, Error::NotRegistered))
    }

    fn require_admin(env: &Env, who: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if admin != *who {
            panic_with_error!(env, Error::Unauthorized);
        }
        who.require_auth();
    }

    fn add_reputation(env: &Env, operator: &Address, delta: i128) {
        let key = DataKey::Reputation(operator.clone());
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(bal + delta));
    }
}

#[cfg(test)]
mod test;

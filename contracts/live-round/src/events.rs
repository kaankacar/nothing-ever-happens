//! Contract events using soroban-sdk 23's `#[contractevent]` macro. Each
//! struct's `publish(&env)` method emits a typed event the indexer can decode
//! from the contract spec — no more deprecation warnings on `events().publish`.

use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent(topics = ["registered"], data_format = "vec")]
pub struct AgentRegistered {
    #[topic]
    pub operator: Address,
    pub delegate: Address,
}

#[contractevent(topics = ["opened"], data_format = "vec")]
pub struct Opened {
    #[topic]
    pub round_id: u32,
    pub question_hash: BytesN<32>,
    pub seed_ledger: u32,
    pub close_ts: u64,
    pub reveal_close_ts: u64,
}

#[contractevent(topics = ["commit"], data_format = "vec")]
pub struct Committed {
    #[topic]
    pub round_id: u32,
    pub delegate: Address,
    pub commit_hash: BytesN<32>,
}

#[contractevent(topics = ["reveal"], data_format = "vec")]
pub struct Revealed {
    #[topic]
    pub round_id: u32,
    pub delegate: Address,
    pub choice: u32,
    pub nonce: BytesN<32>,
}

#[contractevent(topics = ["settled"], data_format = "vec")]
pub struct Settled {
    #[topic]
    pub round_id: u32,
    pub verdict: u32,
    pub seed: BytesN<32>,
    pub winners: u32,
}

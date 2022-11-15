/*
 * ggQuest Profiles Smart Contract
 *
 */

mod events;
pub mod ext_traits;

pub use crate::ext_traits::*;

use ext_traits::ext_ft_contract;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::env::keccak256;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::json;
use near_sdk::{
    env, near_bindgen, require, AccountId, Balance, Gas, GasWeight, PanicOnDefault, Promise,
};

use crate::events::{
    AddOperatorLog, AddRewardLog, EventLog, EventLogVariant, RemoveOperatorLog, SendRewardLog,
};

const GGQUEST_METADATA_SPEC: &str = "1.0.0";
const GGQUEST_STANDARD_NAME: &str = "ggQuest";

// NFTs
const MIN_GAS_FOR_SIMPLE_NFT_TRANSFER: Gas = Gas(10_000_000_000_000); // 10 TGas

// FTs
const MIN_GAS_FOR_FT_TRANSFER: Gas = Gas(5_000_000_000_000); // 5 TGas
const MIN_GAS_FOR_STORAGE_DEPOSIT: Gas = Gas(5_000_000_000_000); // 5 TGas

// Utils
const TGAS: u64 = 1_000_000_000_000;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum RewardType {
    FT,
    NFT,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum CallbackAction {
    AddReward,
    IncreaseRewardAmount,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Reward {
    pub reward_type: RewardType,
    pub reward_contract_account_id: AccountId,
    pub token_amount: U128,
    pub amount: U128, // number of rewards available
    pub id: Option<String>,   // optional NEP-171 token id
}

/// Helper structure for keys of the persistent collections.
#[derive(BorshSerialize)]
pub enum StorageKey {
    Players,
    CompletedByPerOwner,
    OperatorStatusPerOwner,
    RegisteredAccounts,
}

// Define the contract structure
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    pub metadata_url: String,
    pub reputation_reward: U128,
    pub is_active: bool,
    pub gg_profiles: AccountId,
    pub players: UnorderedSet<AccountId>,
    pub completed_by: LookupMap<AccountId, bool>,
    pub operators: LookupMap<AccountId, bool>,
    pub additional_rewards: Vec<Reward>,
}

// Implement the contract structure
#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(
        metadata_url: String,
        reputation_reward: U128,
        profiles_contract: AccountId,
    ) -> Self {
        let mut operators =
            LookupMap::new(StorageKey::OperatorStatusPerOwner.try_to_vec().unwrap());

        operators.insert(&env::predecessor_account_id(), &true);

        Self {
            metadata_url,
            reputation_reward,
            is_active: false,
            gg_profiles: profiles_contract,
            players: UnorderedSet::new(StorageKey::Players.try_to_vec().unwrap()),
            completed_by: LookupMap::new(StorageKey::CompletedByPerOwner.try_to_vec().unwrap()),
            operators,
            additional_rewards: Vec::new(),
        }
    }

    // Operator functions
    #[payable]
    pub fn add_operator(&mut self, account_id: AccountId) {
        assert!(self.is_caller_operator(), "Only operator can add operator");

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        self.operators.insert(&account_id, &true);

        //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        // Emit operator event
        self.emit_event(EventLogVariant::AddOperator(AddOperatorLog {
            operator: account_id.clone(),
        }));
    }

    pub fn remove_operator(&mut self, account_id: AccountId) {
        assert!(
            self.is_caller_operator(),
            "Only operator can remove operator"
        );
        self.operators.remove(&account_id);

        // Emit emove operator event
        self.emit_event(EventLogVariant::RemoveOperator(RemoveOperatorLog {
            operator: account_id.clone(),
        }));
    }

    // Operator view functions
    pub fn is_operator(&self, account_id: AccountId) -> bool {
        self.operators.get(&account_id).unwrap_or(false)
    }

    // Operator private functions
    fn is_caller_operator(&self) -> bool {
        self.operators
            .get(&env::predecessor_account_id())
            .unwrap_or(false)
    }

    // Payable
    #[payable]
    pub fn add_reward(&mut self, reward: Reward) -> Promise {
        assert!(self.is_caller_operator(), "Only operator can add reward");
        assert!(
            !self.is_active,
            "Rewards cannot be added after quest activation"
        );

        self.additional_rewards.iter().for_each(|r| {
            assert!(
                self.internal_reward_hash(r.clone()) != self.internal_reward_hash(reward.clone()),
                "Token contract already used in another reward of the quest"
            )
        });

        self.internal_verify_token_ownership(&reward).then(
            match reward.reward_type {
                RewardType::FT => Self::ext(env::current_account_id()).with_static_gas(Gas(5*TGAS)).verify_ft_ownership_callback(
                    CallbackAction::AddReward,
                    reward.clone(),
                    None,
                ),
                RewardType::NFT => Self::ext(env::current_account_id()).with_static_gas(Gas(5*TGAS)).verify_nft_ownership_callback(
                    CallbackAction::AddReward,
                    reward.clone(),
                    None,
                ),
            }
        )
    }

    #[payable]
    pub fn update_reputation_rewards(&mut self, reputation_reward: U128) {
        assert!(
            self.is_caller_operator(),
            "Only operator can update reputation rewards"
        );

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        self.reputation_reward = reputation_reward;

        //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        self.emit_event(EventLogVariant::UpdateReputationReward(
            events::UpdateReputationRewardLog {
                amount: reputation_reward,
            },
        ));
    }

    #[payable]
    pub fn activate_quest(&mut self) {
        assert!(
            self.is_caller_operator(),
            "Only operator can activate quest"
        );

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        self.is_active = true;

        //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        self.emit_event(EventLogVariant::ActivateQuest);
    }

    #[payable]
    pub fn deactivate_quest(&mut self, withdrawal_account_id: &AccountId) {
        assert!(
            self.is_caller_operator(),
            "Only operator can deactivate quest"
        );

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        self.is_active = false;

        //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        for reward in self.additional_rewards.iter() {
            match reward.reward_type {
                RewardType::FT => {
                    let batch_ft_promise_id =
                                env::promise_batch_create(&reward.reward_contract_account_id);

                    env::promise_batch_action_function_call_weight(
                        batch_ft_promise_id,
                        "storage_deposit",
                        json!({ "account_id": withdrawal_account_id }).to_string().as_bytes(),
                        1250000000000000000000,
                        MIN_GAS_FOR_STORAGE_DEPOSIT,
                        GasWeight(1),
                    );

                    env::promise_batch_action_function_call_weight(
                        batch_ft_promise_id, 
                        "ft_transfer", 
                        json!({ "receiver_id": withdrawal_account_id, "amount": reward.token_amount, "memo": "ggQuest transfer" }).to_string().as_bytes(), 
                        1, 
                        MIN_GAS_FOR_FT_TRANSFER, 
                        GasWeight(1)
                    );
                },
                    RewardType::NFT => {
                    ext_nft_contract::ext(reward.reward_contract_account_id.clone())
                    .with_static_gas(MIN_GAS_FOR_SIMPLE_NFT_TRANSFER)
                    .nft_transfer(
                        withdrawal_account_id.clone(),
                        reward.id.clone().expect("Token ID is required"),
                        None,
                        Some(format!("NFT withdrawal of token with id - {}", reward.id.clone().expect("Token ID is required"))),
                    );
                }
            }
        }

        self.emit_event(EventLogVariant::DeactivateQuest(
            events::DeactivateQuestLog {
                withdrawal_account_id: withdrawal_account_id.clone(),
            },
        ));
    }

    #[payable]
    pub fn send_reward(&mut self, player: AccountId) {
        assert!(self.is_active, "Quest is not active");
        assert!(
            !self.completed_by.get(&player).unwrap_or(false),
            "Player already completed quest"
        );

        let mut reward: Option<Reward> = None;

        for (_index, r) in self.additional_rewards.iter().enumerate() {
            if r.amount.0 > self.players.len().into() {
                reward = Some(r.clone());
                match r.reward_type {
                    RewardType::FT => {
                        let batch_ft_promise_id =
                            env::promise_batch_create(&r.reward_contract_account_id);

                        env::promise_batch_action_function_call_weight(
                            batch_ft_promise_id,
                            "storage_deposit",
                            json!({ "account_id": player }).to_string().as_bytes(),
                            1250000000000000000000,
                            MIN_GAS_FOR_STORAGE_DEPOSIT,
                            GasWeight(1),
                        );

                        env::promise_batch_action_function_call_weight(
                            batch_ft_promise_id, 
                            "ft_transfer", 
                            json!({ "receiver_id": player, "amount": r.token_amount, "memo": "ggQuest transfer" }).to_string().as_bytes(), 
                            1, 
                            MIN_GAS_FOR_FT_TRANSFER, 
                            GasWeight(1)
                        );
                    }
                    RewardType::NFT => {
                        let token_id = r.id.clone().expect("Token ID is required");

                        ext_nft_contract::ext(r.reward_contract_account_id.clone())
                            .with_static_gas(MIN_GAS_FOR_SIMPLE_NFT_TRANSFER)
                            .nft_transfer(
                                player.clone(),
                                token_id.clone(),
                                None,
                                Some(format!("NFT withdrawal of token with id - {}", token_id)),
                            );
                    }
                }
            }
        }

        require!(
            reward.is_some(),
            "All rewards have been distributed"
        );

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        self.players.insert(&player);
        self.completed_by.insert(&player, &true);

          //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        ext_profiles_contract::ext(self.gg_profiles.clone())
            .with_static_gas(Gas(5 * TGAS))
            .increase_reputation(player.clone(), self.reputation_reward);

        self.emit_event(EventLogVariant::SendReward(SendRewardLog {
            reward: reward.unwrap().clone(),
            player,
        }));
    }

    #[payable]
    pub fn increase_reward_amount(&mut self, amount: U128, reward: Reward) {
        assert!(
            self.is_caller_operator(),
            "Only operator can increase reward amount"
        );

        let mut exists = false;

        for i in 0..self.additional_rewards.len() {
            if self.internal_reward_hash(self.additional_rewards[i].clone())
                == self.internal_reward_hash(reward.clone())
            {
                exists = true;

                let mut test_reward = self.additional_rewards[i].clone();

                test_reward.amount = near_sdk::json_types::U128(
                    (test_reward.amount.0 + amount.0) - self.players.len() as u128,
                );

                self.internal_verify_token_ownership(&test_reward).then(
                    match test_reward.reward_type {
                        RewardType::FT => Self::ext(env::current_account_id()).with_static_gas(Gas(5*TGAS)).verify_ft_ownership_callback(
                            CallbackAction::IncreaseRewardAmount,
                            test_reward.clone(),
                            Some(i),
                        ),
                        RewardType::NFT => Self::ext(env::current_account_id()).with_static_gas(Gas(5*TGAS)).verify_nft_ownership_callback(
                            CallbackAction::IncreaseRewardAmount,
                            test_reward.clone(),
                            Some(i),
                        ),
                    }
                );
            }
        }

        require!(
            exists,
            "Given reward (token address) doesn't exist for this quest"
        );
    }

    // View functions
    pub fn get_reputation_reward(&self) -> U128 {
        self.reputation_reward
    }

    pub fn get_quest_uri(&self) -> String {
        self.metadata_url.clone()
    }

    pub fn get_players(&self) -> Vec<AccountId> {
        self.players.to_vec()
    }

    pub fn get_rewards(&self) -> Vec<Reward> {
        self.additional_rewards.clone()
    }

    pub fn internal_reward_hash(&self, reward: Reward) -> Vec<u8> {
        let mut data = reward.reward_contract_account_id.as_bytes().to_vec();
        data.extend_from_slice(&reward.id.unwrap_or("0".to_string()).as_bytes().to_vec());
        keccak256(&data)
    }

    // Verify token ownership
    fn internal_verify_token_ownership(&self, reward: &Reward) -> Promise {
        match reward.reward_type {
            RewardType::FT => ext_ft_contract::ext(reward.reward_contract_account_id.clone())
                .with_static_gas(Gas(5 * TGAS))
                .ft_balance_of(env::current_account_id()),
            RewardType::NFT => ext_nft_contract::ext(reward.reward_contract_account_id.clone())
                .with_static_gas(Gas(5 * TGAS))
                .nft_token(reward.id.clone().expect("Token id is required")),
        }
    }

    // Withdrawal function
    // fn internal_withdraw_rewards(&self, reward_id: usize, account_id: AccountId) -> Promise {
    //     let reward = self.additional_rewards[reward_id].clone();

    //     match reward.reward_type {
    //         RewardType::FT => ext_ft_contract::ext(reward.reward_contract_account_id.clone())
    //             .with_static_gas(Gas(5 * TGAS))
    //             .ft_transfer(
    //                 account_id,
    //                 reward.token_amount,
    //                 Some(format!("FT withdrawal of {}", reward.token_amount.0)),
    //             ),
    //         RewardType::NFT => ext_nft_contract::ext(reward.reward_contract_account_id.clone())
    //             .with_static_gas(MIN_GAS_FOR_SIMPLE_NFT_TRANSFER)
    //             .nft_transfer(
    //                 account_id.clone(),
    //                 reward.id.clone().expect("Token ID is required"),
    //                 None,
    //                 Some(format!("NFT withdrawal of token with id - {}", reward.id.clone().expect("Token ID is required"))),
    //             ),
    //     }
    // }

    #[private]
    pub fn verify_ft_ownership_callback(
        &mut self,
        action: CallbackAction,
        reward: Reward,
        index: Option<usize>,
        #[callback_result] call_result: Result<String, near_sdk::PromiseError>,
    ) -> bool {
        if call_result.is_err() {
            return false;
        }

        let verified = (reward.token_amount.0 * reward.amount.0) <= call_result.unwrap().parse::<u128>().unwrap();
        
        if !verified {
            Promise::new(env::predecessor_account_id()).transfer(env::attached_deposit());
            panic!("ggQuest contract doesn't own enough tokens");
        }

        if action == CallbackAction::IncreaseRewardAmount {
            self.additional_rewards[index.expect("Index is not set")] = reward;
        } else if action == CallbackAction::AddReward {
            //measure the initial storage being used on the contract
            let initial_storage_usage = env::storage_usage();

            self.additional_rewards.push(reward.clone());

            //calculate the required storage which was the used - initial
            let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

            //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
            self.refund_deposit(required_storage_in_bytes);

            self.emit_event(EventLogVariant::AddReward(AddRewardLog { reward }));
        }

         if !verified {
            Promise::new(env::predecessor_account_id()).transfer(env::attached_deposit());
        }

        verified
    }

    #[private]
    pub fn verify_nft_ownership_callback(
        &mut self,
        action: CallbackAction,
        reward: Reward,
        index: Option<usize>,
        #[callback_result] call_result: Result<Token, near_sdk::PromiseError>,
    ) -> bool {
        if call_result.is_err() {
            return false;
        }

        let verified = call_result.unwrap().owner_id == env::current_account_id();

        require!(verified, "ggQuests contract doesn't own this NFT token");
        require!(reward.token_amount.0 == 1 && reward.amount.0 == 1, "token_amount and amount should be 1 as NFT is unique");

        if action == CallbackAction::IncreaseRewardAmount {
            self.additional_rewards[index.expect("Index is not set")] = reward;
        } else if action == CallbackAction::AddReward {
             //measure the initial storage being used on the contract
            let initial_storage_usage = env::storage_usage();

            self.additional_rewards.push(reward.clone());

            //calculate the required storage which was the used - initial
            let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

            //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
            self.refund_deposit(required_storage_in_bytes);

            self.emit_event(EventLogVariant::AddReward(AddRewardLog { reward }));
        }

        verified
    }

    //refund the initial deposit based on the amount of storage that was used up
    fn refund_deposit(&mut self, storage_used: u64) {
        //get how much it would cost to store the information
        let required_cost = env::storage_byte_cost() * Balance::from(storage_used);
        //get the attached deposit
        let attached_deposit = env::attached_deposit();

        //make sure that the attached deposit is greater than or equal to the required cost
        assert!(
            required_cost <= attached_deposit,
            "Must attach {} yoctoNEAR to cover storage",
            required_cost,
        );

        //get the refund amount from the attached deposit - required cost
        let refund = attached_deposit - required_cost;

        //if the refund is greater than 1 yocto NEAR, we refund the predecessor that amount
        if refund > 1 {
            Promise::new(env::predecessor_account_id()).transfer(refund);
        }
    }

    // Utility method to emit an event
    fn emit_event(&self, event_log_variant: EventLogVariant) {
        let log: EventLog = EventLog {
            standard: GGQUEST_STANDARD_NAME.to_string(),
            version: GGQUEST_METADATA_SPEC.to_string(),
            event: event_log_variant,
        };

        // Log the serialized json.
        env::log_str(&log.to_string());
    }
}

/*
 * Inline tests for the code above
 */
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_default_greeting() {
        let contract = Contract::default();
    }
}

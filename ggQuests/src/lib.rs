/*
 * ggQuest Profiles Smart Contract
 *
 */

mod events;
pub mod ext_traits;
pub use crate::ext_traits::*;

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{
    env, log, near_bindgen, require, AccountId, Balance, Gas, PanicOnDefault, Promise, PromiseError,
};

use crate::events::{
    AddGameLog, AddOperatorLog, CreateQuestLog, EventLog, EventLogVariant, RemoveOperatorLog,
};

pub const GGQUEST_METADATA_SPEC: &str = "1.0.0";
pub const GGQUEST_STANDARD_NAME: &str = "ggQuests";

const NEAR_PER_STORAGE: Balance = 10_000_000_000_000_000_000; //1e19yⓃ
const QUEST_CONTRACT: &[u8] =
    include_bytes!("../../ggQuest/target/wasm32-unknown-unknown/release/gg_quest.wasm");
const TGAS: Gas = Gas(10u64.pow(12));
const NO_DEPOSIT: Balance = 0;

pub type QuestId = usize;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct QuestInitArgs {
    metadata_url: String,
    reputation_reward: U128,
    profiles_contract: AccountId,
}

/// Helper structure for keys of the persistent collections.
#[derive(BorshSerialize)]
pub enum StorageKey {
    OperatorStatusPerOwner,
    CompletedQuests,
    CompletedQuestsByAccount,
    GameIdToQuestIds,
    QuestIdToGameId,
}

// Define the contract structure
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    pub operators: LookupMap<AccountId, bool>,
    pub profiles: AccountId,
    pub quests: Vec<AccountId>,
    pub quests_metadata_base_uri: String,
    pub completed_quests: LookupMap<QuestId, u8>,
    pub completed_quests_by_account: LookupMap<AccountId, Vec<QuestId>>,

    pub games: Vec<String>,
    pub games_metadata_base_uri: String,

    pub game_id_to_quest_ids: LookupMap<usize, Vec<QuestId>>,
    pub quest_id_to_game_id: LookupMap<QuestId, usize>,

    quest_contract_code: Vec<u8>,
}

// Implement the contract structure
#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(
        profiles_contract: AccountId,
        quests_metadata_base_uri: String,
        games_metadata_base_uri: String,
    ) -> Self {
        let mut operators =
            LookupMap::new(StorageKey::OperatorStatusPerOwner.try_to_vec().unwrap());

        operators.insert(&env::predecessor_account_id(), &true);

        Self {
            profiles: profiles_contract,
            games_metadata_base_uri,
            quests_metadata_base_uri,
            operators,
            quests: vec![],
            completed_quests: LookupMap::new(StorageKey::CompletedQuests.try_to_vec().unwrap()),
            completed_quests_by_account: LookupMap::new(
                StorageKey::CompletedQuestsByAccount.try_to_vec().unwrap(),
            ),
            games: vec![],
            game_id_to_quest_ids: LookupMap::new(
                StorageKey::GameIdToQuestIds.try_to_vec().unwrap(),
            ),
            quest_id_to_game_id: LookupMap::new(StorageKey::QuestIdToGameId.try_to_vec().unwrap()),
            quest_contract_code: QUEST_CONTRACT.to_vec(),
        }
    }

    // Quest contract code manager
    #[private]
    pub fn update_stored_contract(&mut self) {
        // This method receives the code to be stored in the contract directly
        // from the contract's input. In this way, it avoids the overhead of
        // deserializing parameters, which would consume a huge amount of GAS
        self.quest_contract_code = env::input().expect("Error: No input").to_vec();
    }

    pub fn get_code(&self) -> &Vec<u8> {
        &self.quest_contract_code
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

    // Quests ----------------------------------------------
    #[payable]
    pub fn create_quest(&mut self, reputation_reward: u128, game_id: usize) -> Promise {
        assert!(self.is_caller_operator(), "Only operator can create quest");

        assert!(
            self.games.len() > game_id,
            "Game with id {} does not exist",
            game_id
        );

        // Assert the sub-account is valid
        let current_account = env::current_account_id().to_string();

        let subaccount =
            AccountId::try_from(format!("quest-{}.{}", self.quests.len(), current_account))
                .unwrap();

        assert!(
            env::is_valid_account_id(subaccount.as_bytes()),
            "Invalid subaccount"
        );

        // Assert enough money is attached to create the account and deploy the contract
        let attached = env::attached_deposit();

        let contract_bytes = self.quest_contract_code.len() as u128;
        let minimum_needed = NEAR_PER_STORAGE * contract_bytes;

        let required_deposit = minimum_needed + 2360000000000000000000; // Add more NEAR for storage in callback

        assert!(
            attached >= required_deposit,
            "Attach at least {minimum_needed} yⓃ"
        );

        if attached > required_deposit {
            log!(format!(
                "Required {}yⓃ, attached {}yⓃ, returning {}yⓃ to {}",
                required_deposit,
                attached,
                attached - required_deposit,
                env::predecessor_account_id()
            ));
            Promise::new(env::predecessor_account_id()).transfer(attached - required_deposit);
        }

        let quest_id = self.quests.len();

        let init_args = near_sdk::serde_json::to_vec(&QuestInitArgs {
            metadata_url: format!("{}{}", self.quests_metadata_base_uri.clone(), quest_id),
            reputation_reward: U128(reputation_reward),
            profiles_contract: self.profiles.clone(),
        })
        .unwrap();

        let promise = Promise::new(subaccount.clone())
            .create_account()
            .transfer(attached)
            .deploy_contract(self.quest_contract_code.clone())
            .function_call("new".to_owned(), init_args, NO_DEPOSIT, TGAS * 5);

        // Add callback
        promise.then(Self::ext(env::current_account_id()).create_quest_callback(
            &subaccount,
            game_id,
            env::predecessor_account_id(),
            attached,
        ))
    }

    #[private]
    pub fn create_quest_callback(
        &mut self,
        quest: &AccountId,
        game_id: usize,
        user: AccountId,
        attached: Balance,
        #[callback_result] create_deploy_result: Result<(), PromiseError>,
    ) -> usize {
        if let Ok(_result) = create_deploy_result {
            log!(format!("Correctly created and deployed to {}", quest));

            let quest_id = self.quests.len();

            self.quests.push(quest.clone());

            self.quest_id_to_game_id.insert(&quest_id, &game_id);

            let mut quest_ids = self.game_id_to_quest_ids.get(&game_id).unwrap_or(vec![]);

            quest_ids.push(quest_id);

            self.game_id_to_quest_ids.insert(&game_id, &quest_ids);

            ext_profiles_contract::ext(self.profiles.clone())
                .with_static_gas(TGAS)
                .with_attached_deposit(1180000000000000000000)
                .add_operator(quest.clone());

            self.emit_event(EventLogVariant::CreateQuest(CreateQuestLog {
                quest_id: self.quests.len(),
                game_name: self.games[game_id].clone(),
            }));

            return quest_id;
        };

        log!(format!(
            "Error creating {}, returning {}yⓃ to {}",
            quest, attached, user
        ));

        Promise::new(user).transfer(attached);

        panic!("Error creating quest");
    }

    pub fn add_quest_operator(&self, quest_id: usize, operator: AccountId) {
        assert!(self.is_caller_operator(), "Only operator can add operator");
        assert!(quest_id < self.quests.len(), "Quest ID does not exist");

        let quest = self.quests[quest_id].clone();

        ext_quest_contract::ext(quest.clone())
            .with_static_gas(TGAS)
            .with_attached_deposit(10000000000000000000000)
            .add_operator(operator.clone());
    }

    pub fn remove_quest_operator(&self, quest_id: usize, operator: AccountId) {
        assert!(self.is_caller_operator(), "Only operator can add operator");
        assert!(quest_id < self.quests.len(), "Quest ID does not exist");

        let quest = self.quests[quest_id].clone();

        ext_quest_contract::ext(quest.clone())
            .with_static_gas(TGAS)
            .with_attached_deposit(10000000000000000000000)
            .remove_operator(operator.clone());
    }

    pub fn get_quest_address(&self, quest_id: QuestId) -> AccountId {
        self.quests
            .get(quest_id as usize)
            .expect("QuestID does not exist")
            .clone()
    }

    #[payable]
    pub fn get_quest_uri(&mut self, quest_id: QuestId) -> Promise {
        assert!(quest_id < self.quests.len(), "Quest ID does not exist");

        ext_quest_contract::ext(self.get_quest_address(quest_id))
            .with_static_gas(TGAS)
            .get_quest_uri()
            .then(Self::ext(env::current_account_id()).get_quest_uri_callback())
    }

    #[private]
    pub fn get_quest_uri_callback(
        &self,
        #[callback_result] quest_uri: Result<String, PromiseError>,
    ) -> String {
        if let Ok(quest_uri) = quest_uri {
            return quest_uri;
        };

        "Error".to_string()
    }

    pub fn get_quests(&self) -> Vec<AccountId> {
        self.quests.clone()
    }

    // Games & Game studios --------------------------------
    #[payable]
    pub fn add_game(&mut self, game_name: String) -> usize {
        assert!(self.is_caller_operator(), "Only operator can add game");

        //measure the initial storage being used on the contract
        let initial_storage_usage = env::storage_usage();

        let name = &game_name.clone();

        self.games.push(name.to_string());

        //calculate the required storage which was the used - initial
        let required_storage_in_bytes = env::storage_usage() - initial_storage_usage;

        //refund any excess storage if the user attached too much. Panic if they didn't attach enough to cover the required.
        self.refund_deposit(required_storage_in_bytes);

        // Emit operator event
        self.emit_event(EventLogVariant::AddGame(AddGameLog {
            game_name: name.to_string(),
            game_id: self.games.len() - 1,
        }));

        self.games.len() - 1
    }

    pub fn get_url_metadata(&self, game_id: usize) -> String {
        require!(
            self.games.len() > game_id,
            format!("Game with id {} does not exist", game_id)
        );

        format!("{}{}", self.games_metadata_base_uri, game_id.to_string())
    }

    pub fn get_games(&self) -> Vec<String> {
        self.games.to_vec()
    }

    // Utility functions

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

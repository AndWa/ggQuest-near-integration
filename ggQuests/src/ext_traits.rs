use near_sdk::ext_contract;

use crate::*;

/// ggProfiles contract
#[ext_contract(ext_profiles_contract)]
trait ExtProfilesContract {
    fn add_operator(&mut self, account_id: AccountId);
}

// ggQuest contract
#[ext_contract(ext_quest_contract)]
trait ExtQuestContract {
    fn add_operator(&mut self, account_id: AccountId);
    fn remove_operator(&mut self, account_id: AccountId);
    fn get_quest_uri(&self) -> String;
}

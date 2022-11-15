use near_sdk::ext_contract;

use crate::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
}

// Interface of this contract, for callbacks
#[ext_contract(this_contract)]
trait Callbacks {
    fn verify_ft_ownership_callback(
        &mut self,
        action: CallbackAction,
        reward: Reward,
        index: Option<usize>,
    ) -> bool;
    fn verify_nft_ownership_callback(
        &mut self,
        action: CallbackAction,
        reward: Reward,
        index: Option<usize>,
    ) -> bool;
    fn deactivate_quest_callback(&self) -> bool;
}

/// NFT contract
#[ext_contract(ext_nft_contract)]
trait ExtNFTContract {
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    );

    fn nft_token(&self, token_id: String) -> Token;
}

/// FT contract
#[ext_contract(ext_ft_contract)]
trait ExtFTContract {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

/// ggProfiles contract
#[ext_contract(ext_profiles_contract)]
trait ExtProfilesContract {
    fn increase_reputation(&mut self, account_id: AccountId, amount: U128);
}

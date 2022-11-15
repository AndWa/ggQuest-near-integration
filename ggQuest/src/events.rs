use std::fmt;

use near_sdk::{
    json_types::U128,
    serde::{Deserialize, Serialize},
    serde_json, AccountId,
};

use crate::Reward;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
#[serde(crate = "near_sdk::serde")]
#[non_exhaustive]
pub enum EventLogVariant {
    AddOperator(AddOperatorLog),
    RemoveOperator(RemoveOperatorLog),

    AddReward(AddRewardLog),
    SendReward(SendRewardLog),
    UpdateReputationReward(UpdateReputationRewardLog),
    ActivateQuest,
    DeactivateQuest(DeactivateQuestLog),
}

/// Interface to capture data about an event
///
/// Arguments:
/// * `standard`: name of standard e.g. nep171
/// * `version`: e.g. 1.0.0
/// * `event`: associate event data
#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct EventLog {
    pub standard: String,
    pub version: String,

    // `flatten` to not have "event": {<EventLogVariant>} in the JSON, just have the contents of {<EventLogVariant>}.
    #[serde(flatten)]
    pub event: EventLogVariant,
}

impl fmt::Display for EventLog {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_fmt(format_args!(
            "EVENT_JSON:{}",
            &serde_json::to_string(self).map_err(|_| fmt::Error)?
        ))
    }
}

/// An event log
#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct AddOperatorLog {
    pub operator: AccountId,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct RemoveOperatorLog {
    pub operator: AccountId,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct AddRewardLog {
    pub reward: Reward,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct SendRewardLog {
    pub player: AccountId,
    pub reward: Reward,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct UpdateReputationRewardLog {
    pub amount: U128,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DeactivateQuestLog {
    pub withdrawal_account_id: AccountId,
}

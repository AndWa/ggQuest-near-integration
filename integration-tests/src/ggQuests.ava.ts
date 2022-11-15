import anyTest, { TestFn } from "ava";
import { utils } from "near-api-js";
import { BN, NEAR, NearAccount, Worker } from "near-workspaces";

const STORAGE_BYTE_COST = "1.5 mN";
const INITIAL_SUPPLY = "10000";

async function registerUser(ft: NearAccount, user: NearAccount) {
  await ft.call(
    ft,
    "storage_deposit",
    { account_id: user },
    // Deposit pulled from ported sim test
    { attachedDeposit: STORAGE_BYTE_COST }
  );
}

async function ft_balance_of(ft: NearAccount, user: NearAccount): Promise<BN> {
  return new BN(await ft.view("ft_balance_of", { account_id: user }));
}

async function transfer(
  ft: NearAccount,
  sender: NearAccount,
  receiver: NearAccount,
  amount: string
) {
  await sender.call(
    ft,
    "ft_transfer",
    {
      receiver_id: receiver.accountId,
      amount: new BN(amount),
    },
    { attachedDeposit: "1" }
  );
}

async function createAndRetrieveQuest(
  root: NearAccount,
  ggQuests: NearAccount,
  questOperator: NearAccount
): Promise<NearAccount> {
  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Axie Infinity" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggQuests.call(
    ggQuests,
    "create_quest",
    { reputation_reward: 15, game_id: 0 },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("2.1")?.toString(),
    }
  );

  await ggQuests.call(
    ggQuests,
    "add_quest_operator",
    {
      quest_id: 0,
      operator: questOperator.accountId,
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const quests: string[] = await ggQuests.view("get_quests");

  const quest = root.getAccount(quests[quests.length - 1]);

  return quest;
}

// Tests
const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async (t) => {
  // Init the worker and start a Sandbox server
  const worker = await Worker.init();

  const root = worker.rootAccount;

  const john = await root.createSubAccount("john", {
    initialBalance: NEAR.parse("50 N").toJSON(),
  });

  const bob = await root.createSubAccount("bob", {
    initialBalance: NEAR.parse("50 N").toJSON(),
  });

  // Deploy contracts
  const ggProfiles = await root.createSubAccount("gg_profiles", {
    initialBalance: NEAR.parse("50 N").toJSON(),
  });

  await ggProfiles.deploy(
    "./ggProfiles/target/wasm32-unknown-unknown/release/gg_profiles.wasm"
  );

  // Init contract
  await ggProfiles.call(ggProfiles, "new", {
    name: ggProfiles.accountId,
    ticker: "GGP",
  });

  const ggQuests = await root.createSubAccount("gg_quests", {
    initialBalance: NEAR.parse("50 N").toJSON(),
  });

  await ggQuests.deploy(
    "./ggQuests/target/wasm32-unknown-unknown/release/gg_quests.wasm"
  );

  // Init contract
  await ggQuests.call(ggQuests, "new", {
    profiles_contract: ggProfiles.accountId,
    quests_metadata_base_uri: "https://gg.quest/api/quests/",
    games_metadata_base_uri: "https://gg.quest/api/games/",
  });

  await ggProfiles.call(
    ggProfiles,
    "add_operator",
    { account_id: ggQuests.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggProfiles.call(
    ggProfiles,
    "mint",
    {
      data: {
        pseudo: "deployer",
        profile_picture_url: "",
        cover_picture_url: "",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await john.call(
    ggProfiles,
    "mint",
    {
      data: {
        pseudo: john.accountId,
        profile_picture_url: "",
        cover_picture_url: "",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    ggProfiles,
    "mint",
    {
      data: {
        pseudo: bob.accountId,
        profile_picture_url: "",
        cover_picture_url: "",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  // FT contracts
  const ftContractOne = await root.createSubAccount("ft_contract_one", {
    initialBalance: NEAR.parse("10 N").toJSON(),
  });

  await ftContractOne.deploy("./fungible_token_test/fungible_token.wasm");

  await ftContractOne.call(ftContractOne, "new_default_meta", {
    owner_id: ftContractOne.accountId,
    total_supply: INITIAL_SUPPLY,
  });

  const ftContractTwo = await root.createSubAccount("ft_contract_two", {
    initialBalance: NEAR.parse("10 N").toJSON(),
  });

  await ftContractTwo.deploy("./fungible_token_test/fungible_token.wasm");

  await ftContractTwo.call(ftContractTwo, "new_default_meta", {
    owner_id: ftContractTwo.accountId,
    total_supply: INITIAL_SUPPLY,
  });

  // Save state for test runs, it is unique for each test
  t.context.worker = worker;
  t.context.accounts = {
    root,
    ggProfiles,
    ggQuests,
    ftContractOne,
    ftContractTwo,
    bob,
    john,
  };
});

test.afterEach.always(async (t) => {
  // Stop Sandbox server
  await t.context.worker.tearDown().catch((error) => {
    console.log("Failed to stop the Sandbox:", error);
  });
});

// Games tests
test("Non-operator shouldn't add game", async (t) => {
  const { ggQuests, john } = t.context.accounts;

  const error = await t.throwsAsync(
    john.call(
      ggQuests,
      "add_game",
      { game_name: "Axie Infinity" },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should add game and return correct URL", async (t) => {
  const { ggQuests } = t.context.accounts;

  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Axie Infinity" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Eve.io" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const games: string[] = await ggQuests.view("get_games");

  t.is(games.length, 2);
  t.deepEqual(games, ["Axie Infinity", "Eve.io"]);

  const gameOneUrl: string = await ggQuests.view("get_url_metadata", {
    game_id: 0,
  });

  t.is(gameOneUrl, "https://gg.quest/api/games/0");

  const gameTwoUrl: string = await ggQuests.view("get_url_metadata", {
    game_id: 1,
  });

  t.is(gameTwoUrl, "https://gg.quest/api/games/1");

  const error = await t.throwsAsync(
    ggQuests.view("get_url_metadata", {
      game_id: 2,
    })
  );

  t.not(error, undefined);
});

// Quests tests
test("Should create quests and return right URI", async (t) => {
  const { ggQuests } = t.context.accounts;

  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Axie Infinity" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Eve.io" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggQuests.call(
    ggQuests,
    "create_quest",
    { reputation_reward: 15, game_id: 0 },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("2.1")?.toString(),
    }
  );

  await ggQuests.call(
    ggQuests,
    "create_quest",
    { reputation_reward: 20, game_id: 0 },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("2.1")?.toString(),
    }
  );

  await ggQuests.call(
    ggQuests,
    "create_quest",
    { reputation_reward: 10, game_id: 1 },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("2.1")?.toString(),
    }
  );

  const quests: string[] = await ggQuests.view("get_quests");

  t.is(quests.length, 3);

  const questOneUrl: string = await ggQuests.call(
    ggQuests,
    "get_quest_uri",
    {
      quest_id: 0,
    },
    { gas: "80000000000000", attachedDeposit: "1" }
  );

  t.is(questOneUrl, "https://gg.quest/api/quests/0");

  const questTwoUrl: string = await ggQuests.call(
    ggQuests,
    "get_quest_uri",
    {
      quest_id: 1,
    },
    { gas: "80000000000000", attachedDeposit: "1" }
  );

  t.is(questTwoUrl, "https://gg.quest/api/quests/1");

  const questThreeUrl: string = await ggQuests.call(
    ggQuests,
    "get_quest_uri",
    {
      quest_id: 2,
    },
    { gas: "80000000000000", attachedDeposit: "1" }
  );

  t.is(questThreeUrl, "https://gg.quest/api/quests/2");

  const error = await t.throwsAsync(
    ggQuests.call(
      ggQuests,
      "get_quest_uri",
      {
        quest_id: 3,
      },
      { gas: "80000000000000", attachedDeposit: "1" }
    )
  );

  t.not(error, undefined);
});

test("Should add operator to quest", async (t) => {
  const { ggQuests, john, root } = t.context.accounts;

  await ggQuests.call(
    ggQuests,
    "add_game",
    { game_name: "Axie Infinity" },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await ggQuests.call(
    ggQuests,
    "create_quest",
    { reputation_reward: 15, game_id: 0 },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("2.1")?.toString(),
    }
  );

  await ggQuests.call(
    ggQuests,
    "add_quest_operator",
    {
      quest_id: 0,
      operator: john.accountId,
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const quests: string[] = await ggQuests.view("get_quests");

  const quest = root.getAccount(quests[0]);

  const isOperator = await quest.view("is_operator", {
    account_id: john.accountId,
  });

  t.is(isOperator, true);
});

test("Should not add not owned reward", async (t) => {
  const { ggQuests, john, root, ftContractOne } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  let error = await t.throwsAsync(
    john.call(
      quest,
      "add_reward",
      {
        reward: {
          reward_type: "FT",
          reward_contract_account_id: ftContractOne.accountId,
          token_amount: "20",
          amount: "10",
          id: "0",
        },
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  error = await t.throwsAsync(
    john.call(
      quest,
      "add_reward",
      {
        reward: {
          reward_type: "FT",
          reward_contract_account_id: ftContractOne.accountId,
          token_amount: "20",
          amount: "10",
          id: "0",
        },
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);
});

test("Should add reward", async (t) => {
  const { ggQuests, john, root, ftContractOne } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");
});

test("Should not add reward with same token as existing reward", async (t) => {
  const { ggQuests, john, root, ftContractOne } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await transfer(ftContractOne, ftContractOne, quest, "1");

  const error = await t.throwsAsync(
    john.call(
      quest,
      "add_reward",
      {
        reward: {
          reward_type: "FT",
          reward_contract_account_id: ftContractOne.accountId,
          token_amount: "1",
          amount: "1",
          id: "0",
        },
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);
});

test("Should not add rewards after activation", async (t) => {
  const { ggQuests, john, root, ftContractOne, ftContractTwo } =
    t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call(
    quest,
    "activate_quest",
    {},
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  await registerUser(ftContractTwo, quest);
  await transfer(ftContractTwo, ftContractTwo, quest, "20");

  const error = await t.throwsAsync(
    john.call(
      quest,
      "add_reward",
      {
        reward: {
          reward_type: "FT",
          reward_contract_account_id: ftContractTwo.accountId,
          token_amount: "30",
          amount: "1",
          id: "0",
        },
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);
});

test("Should send reward and reputation when completed", async (t) => {
  const { ggProfiles, ggQuests, john, root, ftContractOne, bob } =
    t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call(
    quest,
    "activate_quest",
    {},
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  await john.call(
    quest,
    "send_reward",
    {
      player: bob.accountId,
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const balance = await ft_balance_of(ftContractOne, bob);
  t.is(balance.toNumber(), new BN("20").toNumber());

  const reputation: string[] = await ggProfiles.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.is(reputation[0], "15");
});

test("Should revert if no more reward available", async (t) => {
  const { ggProfiles, ggQuests, john, root, ftContractOne, bob } =
    t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call(
    quest,
    "activate_quest",
    {},
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  await john.call(
    quest,
    "send_reward",
    {
      player: bob.accountId,
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  let balance = await ft_balance_of(ftContractOne, bob);
  t.is(balance.toNumber(), new BN("20").toNumber());

  let reputation: string[] = await ggProfiles.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.is(reputation[0], "15");

  const error = await t.throwsAsync(
    john.call(
      quest,
      "send_reward",
      {
        player: john.accountId,
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);

  balance = await ft_balance_of(ftContractOne, john);
  t.is(balance.toNumber(), new BN("0").toNumber());

  reputation = await ggProfiles.view("get_reputation", {
    account_id: john.accountId,
  });

  t.is(reputation[0], "0");
});

test("Should not send reward and reputation if already completed", async (t) => {
  const { ggProfiles, ggQuests, john, root, ftContractOne, bob } =
    t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call(
    quest,
    "activate_quest",
    {},
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  await john.call(
    quest,
    "send_reward",
    {
      player: bob.accountId,
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  let balance = await ft_balance_of(ftContractOne, bob);
  t.is(balance.toNumber(), new BN("20").toNumber());

  let reputation: string[] = await ggProfiles.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.is(reputation[0], "15");

  const error = await t.throwsAsync(
    john.call(
      quest,
      "send_reward",
      {
        player: bob.accountId,
      },
      {
        gas: "80000000000000",
        attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
      }
    )
  );

  t.not(error, undefined);

  balance = await ft_balance_of(ftContractOne, john);
  t.is(balance.toNumber(), new BN("0").toNumber());

  balance = await ft_balance_of(ftContractOne, bob);
  t.is(balance.toNumber(), new BN("20").toNumber());

  reputation = await ggProfiles.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.is(reputation[0], "15");
});

test("Should not update quest reward if not enough tokens", async (t) => {
  const { ggQuests, john, root, ftContractOne } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  let rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call<boolean>(
    quest,
    "increase_reward_amount",
    {
      amount: "5",
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  rewards = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");
});

test("Should update quest reward", async (t) => {
  const { ggQuests, john, root, ftContractOne } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  let rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await transfer(ftContractOne, ftContractOne, quest, "100");

  await john.call<boolean>(
    quest,
    "increase_reward_amount",
    {
      amount: "5",
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  rewards = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "6");
  t.is(rewards[0].id, "0");
});

test("Should update reputation reward", async (t) => {
  const { ggQuests, john, root } = t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await john.call(
    quest,
    "update_reputation_rewards",
    {
      reputation_reward: "30",
    },
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const reputation_reward = await quest.view("get_reputation_reward");

  t.is(reputation_reward, "30");
});

test("Should withdraw all remaining rewards after deactivation", async (t) => {
  const { ggProfiles, ggQuests, john, root, ftContractOne, bob } =
    t.context.accounts;

  const quest = await createAndRetrieveQuest(root, ggQuests, john);

  await registerUser(ftContractOne, quest);
  await registerUser(ftContractOne, bob);
  await transfer(ftContractOne, ftContractOne, quest, "20");

  await john.call(
    quest,
    "add_reward",
    {
      reward: {
        reward_type: "FT",
        reward_contract_account_id: ftContractOne.accountId,
        token_amount: "20",
        amount: "1",
        id: "0",
      },
    },
    {
      gas: "80000000000000",
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  const rewards: {
    reward_type: string;
    reward_contract_account_id: string;
    token_amount: string;
    amount: string;
    id: string;
  }[] = await quest.view("get_rewards");

  t.is(rewards.length, 1);
  t.is(rewards[0].reward_type, "FT");
  t.is(rewards[0].reward_contract_account_id, ftContractOne.accountId);
  t.is(rewards[0].token_amount, "20");
  t.is(rewards[0].amount, "1");
  t.is(rewards[0].id, "0");

  await john.call(
    quest,
    "activate_quest",
    {},
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  await john.call(
    quest,
    "deactivate_quest",
    {
      withdrawal_account_id: bob.accountId,
    },
    {
      attachedDeposit: utils.format.parseNearAmount("0.01")?.toString(),
    }
  );

  let balance = await ft_balance_of(ftContractOne, bob);
  t.is(balance.toNumber(), new BN("20").toNumber());
});

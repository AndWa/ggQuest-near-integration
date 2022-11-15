import anyTest, { TestFn } from "ava";
import { utils } from "near-api-js";
import { NEAR, NearAccount, Worker } from "near-workspaces";

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async (t) => {
  // Init the worker and start a Sandbox server
  const worker = await Worker.init();

  // Deploy contract
  const root = worker.rootAccount;

  const john = await root.createSubAccount("john", {
    initialBalance: NEAR.parse("3 N").toJSON(),
  });

  const bob = await root.createSubAccount("bob", {
    initialBalance: NEAR.parse("3 N").toJSON(),
  });

  const sam = await root.createSubAccount("sam", {
    initialBalance: NEAR.parse("7 N").toJSON(),
  });

  const contract = await root.createSubAccount("gg_profiles");

  await contract.deploy(
    "./ggProfiles/target/wasm32-unknown-unknown/release/gg_profiles.wasm"
  );

  // Init contract
  await root.call(contract, "new", {
    name: root.accountId,
    ticker: "GGP",
  });

  // Save state for test runs, it is unique for each test
  t.context.worker = worker;
  t.context.accounts = { root, contract, bob, john, sam };
});

test.afterEach.always(async (t) => {
  // Stop Sandbox server
  await t.context.worker.tearDown().catch((error) => {
    console.log("Failed to stop the Sandbox:", error);
  });
});

// Operator tests
test("Operator should add operator", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const isOperator = await contract.view("is_operator", {
    account_id: bob.accountId,
  });

  t.is(isOperator, true);
});

test("Operator should remove operator", async (t) => {
  const { root, contract, bob } = t.context.accounts;
  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  let isOperator = await contract.view("is_operator", {
    account_id: bob.accountId,
  });

  t.is(isOperator, true);

  await root.call(contract, "remove_operator", { account_id: bob.accountId });

  isOperator = await contract.view("is_operator", {
    account_id: bob.accountId,
  });

  t.is(isOperator, false);
});

test("Non-operator should not add operator", async (t) => {
  const { contract, john, bob } = t.context.accounts;

  const error = await t.throwsAsync(
    john.call(
      contract,
      "add_operator",
      { account_id: bob.accountId },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Non-operator should not remove operator", async (t) => {
  const { root, contract, john, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const isOperator = await contract.view("is_operator", {
    account_id: bob.accountId,
  });

  t.is(isOperator, true);

  const error = await t.throwsAsync(
    john.call(contract, "remove_operator", { account_id: bob.accountId })
  );

  t.not(error, undefined);
});

// Minting tests
test("Should register sender by creating profile", async (t) => {
  const { contract, bob } = t.context.accounts;

  await bob.call(
    contract,
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

  const profile: { pseudo: string } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  const hasProfileData = await contract.view("has_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(hasProfileData, true);
});

test("Should not register empty pseudo", async (t) => {
  const { contract, bob } = t.context.accounts;

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "mint",
      {
        data: {
          pseudo: "",
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should not register already registered pseudo", async (t) => {
  const { contract, bob, john } = t.context.accounts;

  await bob.call(
    contract,
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

  const error = await t.throwsAsync(
    john.call(
      contract,
      "mint",
      {
        data: {
          pseudo: bob.accountId,
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should not register twice the same address", async (t) => {
  const { contract, bob } = t.context.accounts;

  await bob.call(
    contract,
    "mint",
    {
      data: {
        pseudo: "bob",
        profile_picture_url: "",
        cover_picture_url: "",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "mint",
      {
        data: {
          pseudo: "bob2",
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

// Burning tests
test("Operator should delete user profile", async (t) => {
  const { root, contract, bob, john } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: john.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  let hasProfileData = await contract.view("has_profile_data", {
    account_id: bob.accountId,
  });

  t.is(hasProfileData, true);

  await john.call(contract, "burn", { account_id: bob.accountId });

  hasProfileData = await contract.view("has_profile_data", {
    account_id: bob.accountId,
  });

  t.is(hasProfileData, false);
});

test("Non-operator should not delete user profile", async (t) => {
  const { contract, bob, john } = t.context.accounts;

  await bob.call(
    contract,
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

  let hasProfileData = await contract.view("has_profile_data", {
    account_id: bob.accountId,
  });

  t.is(hasProfileData, true);

  const error = await t.throwsAsync(
    john.call(contract, "burn", { account_id: bob.accountId })
  );

  t.not(error, undefined);
});

// Updating tests
test("Should not allow unminted profile update", async (t) => {
  const { contract, bob } = t.context.accounts;

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "update",
      {
        data: {
          pseudo: bob.accountId,
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should not allow empty pseudo", async (t) => {
  const { contract, bob } = t.context.accounts;

  await bob.call(
    contract,
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

  const profile: { pseudo: string } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "update",
      {
        data: {
          pseudo: "",
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should not allow updates with already taken pseudo", async (t) => {
  const { contract, bob, john } = t.context.accounts;

  await john.call(
    contract,
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
    contract,
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

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "update",
      {
        data: {
          pseudo: john.accountId,
          profile_picture_url: "",
          cover_picture_url: "",
        },
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Should update user data", async (t) => {
  const { contract, bob } = t.context.accounts;

  await bob.call(
    contract,
    "mint",
    {
      data: {
        pseudo: bob.accountId,
        profile_picture_url: "x",
        cover_picture_url: "y",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  let profile: {
    pseudo: string;
    profile_picture_url: string;
    cover_picture_url: string;
  } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(profile.profile_picture_url, "x");
  t.is(profile.cover_picture_url, "y");

  await bob.call(
    contract,
    "update",
    {
      data: {
        pseudo: "bob_modified",
        profile_picture_url: "https://url1/image.png",
        cover_picture_url: "https://url2/image.png",
      },
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  profile = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, "bob_modified");
  t.is(profile.profile_picture_url, "https://url1/image.png");
  t.is(profile.cover_picture_url, "https://url2/image.png");
});

// Reputation tests
test("Only operators should increase or decrease reputation", async (t) => {
  const { contract, bob, john } = t.context.accounts;

  await bob.call(
    contract,
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

  const increase_reputation_error = await t.throwsAsync(
    john.call(contract, "increase_reputation", {
      account_id: bob.accountId,
      amount: "10",
    })
  );

  t.not(increase_reputation_error, undefined);

  const decrease_reputation_error = await t.throwsAsync(
    john.call(contract, "decrease_reputation", {
      account_id: bob.accountId,
      amount: "5",
    })
  );

  t.not(decrease_reputation_error, undefined);
});

test("Reputation change should revert if no profile associated with address", async (t) => {
  const { root, contract, bob, john } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: john.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const increase_reputation_error = await t.throwsAsync(
    john.call(contract, "increase_reputation", {
      account_id: bob.accountId,
      amount: "10",
    })
  );

  t.not(increase_reputation_error, undefined);

  const decrease_reputation_error = await t.throwsAsync(
    john.call(contract, "decrease_reputation", {
      account_id: bob.accountId,
      amount: "5",
    })
  );

  t.not(decrease_reputation_error, undefined);
});

test("Should increase reputation", async (t) => {
  const { root, contract, bob, john } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: john.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  let reputation = await contract.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.deepEqual(reputation, ["0", "0"]);

  await john.call(contract, "increase_reputation", {
    account_id: bob.accountId,
    amount: "10",
  });

  reputation = await contract.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.deepEqual(reputation, ["10", "0"]);
});

test("Should decrease reputation", async (t) => {
  const { root, contract, bob, john } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: john.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  let reputation = await contract.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.deepEqual(reputation, ["0", "0"]);

  await john.call(contract, "increase_reputation", {
    account_id: bob.accountId,
    amount: "10",
  });

  reputation = await contract.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.deepEqual(reputation, ["10", "0"]);

  await john.call(contract, "decrease_reputation", {
    account_id: bob.accountId,
    amount: "5",
  });

  reputation = await contract.view("get_reputation", {
    account_id: bob.accountId,
  });

  t.deepEqual(reputation, ["10", "5"]);
});

// Third parties tests
test("Only operators should add a supported third party", async (t) => {
  const { contract, bob } = t.context.accounts;

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "add_third_party",
      {
        third_party_name: "DISCORD",
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

test("Only operators should link or unlink a third party to a profile", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_third_party",
    {
      third_party_name: "DISCORD",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  const link_error = await t.throwsAsync(
    bob.call(
      contract,
      "link_third_party_to_profile",
      {
        account_id: bob.accountId,
        third_party_id: "DISCORD",
        third_party_user_id: "123456789",
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(link_error, undefined);

  const unlink_error = await t.throwsAsync(
    bob.call(contract, "unlink_third_party_from_profile", {
      account_id: bob.accountId,
      third_party_id: "DISCORD",
    })
  );

  t.not(unlink_error, undefined);
});

test("Should add a supported third party", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "DISCORD",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "TWITCH",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "YOUTUBE",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "STREAM",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const third_parties = await contract.view("get_third_parties", {});

  t.deepEqual(third_parties, ["DISCORD", "TWITCH", "YOUTUBE", "STREAM"]);
});

test("Should link a third party to a profile", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "DISCORD",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "link_third_party_to_profile",
    {
      account_id: bob.accountId,
      third_party_id: "DISCORD",
      third_party_user_id: "123456789",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  const profile: {
    pseudo: string;
    linked_third_parties: Array<{
      third_party_id: string;
      user_id: string;
    }>;
  } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(profile.linked_third_parties[0].third_party_id, "DISCORD");
  t.is(profile.linked_third_parties[0].user_id, "123456789");
});

test("Should unlink a third party to a profile", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "DISCORD",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "link_third_party_to_profile",
    {
      account_id: bob.accountId,
      third_party_id: "DISCORD",
      third_party_user_id: "123456789",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  let profile: {
    pseudo: string;
    linked_third_parties: Array<{
      third_party_id: string;
      user_id: string;
    }>;
  } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(profile.linked_third_parties[0].third_party_id, "DISCORD");
  t.is(profile.linked_third_parties[0].user_id, "123456789");

  await bob.call(contract, "unlink_third_party_from_profile", {
    account_id: bob.accountId,
    third_party_id: "DISCORD",
  });

  profile = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(profile.linked_third_parties.length, 0);
});

test("Should not link a third party twice to the same profile", async (t) => {
  const { root, contract, bob } = t.context.accounts;

  await root.call(
    contract,
    "add_operator",
    { account_id: bob.accountId },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
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

  await bob.call(
    contract,
    "add_third_party",
    {
      third_party_name: "DISCORD",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  await bob.call(
    contract,
    "link_third_party_to_profile",
    {
      account_id: bob.accountId,
      third_party_id: "DISCORD",
      third_party_user_id: "123456789",
    },
    { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
  );

  let profile: {
    pseudo: string;
    linked_third_parties: Array<{
      third_party_id: string;
      user_id: string;
    }>;
  } = await contract.view("get_profile_data", {
    account_id: bob.accountId,
  });

  t.is(profile.pseudo, bob.accountId);
  t.is(profile.linked_third_parties[0].third_party_id, "DISCORD");
  t.is(profile.linked_third_parties[0].user_id, "123456789");

  const error = await t.throwsAsync(
    bob.call(
      contract,
      "link_third_party_to_profile",
      {
        account_id: bob.accountId,
        third_party_id: "DISCORD",
        third_party_user_id: "987654321",
      },
      { attachedDeposit: utils.format.parseNearAmount("0.01")?.toString() }
    )
  );

  t.not(error, undefined);
});

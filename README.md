# near-ggQuest

# Start

If you haven't installed dependencies during setup:

    npm install

Build and deploy your contracts to TestNet with a temporary dev accounts:

    npm run deploy

Run integration tests for your contracts:

    npm test

# Exploring The Code

Smart contract code is located in `ggProfiles`, `ggQuest` and `ggQuests` directories.

Integration tests are located in `integration-tests` directory.

# Deploy

Every smart contract in NEAR has its [own associated account][near accounts].
When you run `npm run deploy`, your smart contract gets deployed to the live NEAR TestNet with a temporary dev account.
When you're ready to make it permanent, here's how:

## Step 0: Install near-cli (optional)

[near-cli] is a command line interface (CLI) for interacting with the NEAR blockchain. It was installed to the local `node_modules` folder when you ran `npm install`, but for best ergonomics you may want to install it globally:

    npm install --global near-cli

Or, if you'd rather use the locally-installed version, you can prefix all `near` commands with `npx`

Ensure that it's installed with `near --version` (or `npx near --version`)

## Step 1: Create an account for the contract

Each account on NEAR can have at most one contract deployed to it.

You will need to have an account created on NEAR Wallet.

1. Authorize NEAR CLI, following the commands it gives you:

   ```bash
   near login
   ```

2. Create a subaccount (you should already have an account created):

   Example is using `ggQuest.testnet` as the master account.

   ```bash
   near create-account ggProfiles.ggQuest.testnet --masterAccount ggQuest.testnet

   near create-account ggQuests.ggQuest.testnet --masterAccount ggQuest.testnet
   ```

## Step 2: deploy the contract

Use the CLI to deploy the contract to TestNet with your account ID.
Replace `PATH_TO_WASM_FILE` with the `wasm` that was generated in `contract` build directory.

    near deploy --accountId ggProfiles.ggQuest.testnet --wasmFile ./ggProfiles/target/wasm32-unknown-unknown/release/gg_profiles.wasm

    near deploy --accountId ggQuests.ggQuest.testnet --wasmFile ./ggQuests/target/wasm32-unknown-unknown/release/gg_quests.wasm

# Troubleshooting

On Windows, if you're seeing an error containing `EPERM` it may be related to spaces in your path. Please see [this issue](https://github.com/zkat/npx/issues/209) for more details.

---

[node.js]: https://nodejs.org/en/download/package-manager/
[near accounts]: https://docs.near.org/concepts/basics/account
[near wallet]: https://wallet.testnet.near.org/
[near-cli]: https://github.com/near/near-cli

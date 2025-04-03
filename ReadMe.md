# Bridge Automation Tool

A streamlined tool for automating token bridge transactions between Sepolia and destination chains (Babylon Testnet and Union Testnet).

## Installation

1. **Clone this repository**
2. **Install dependencies**

```bash
npm install
```

3. **Set up your wallet configuration**

You can configure up to 5 wallets in the `.env` file with their corresponding destination addresses:

```javascript
# Wallet 1
WALLET_1_PRIVATE_KEY=0xYourPrivateKeyHere
WALLET_1_UNION_ADDRESS=union1youraddresshere
WALLET_1_BABYLON_ADDRESS=bbn1youraddresshere

# Wallet 2 (optional)
WALLET_2_PRIVATE_KEY=
WALLET_2_UNION_ADDRESS=
WALLET_2_BABYLON_ADDRESS=

# Add up to 5 wallet configurations following the same pattern
# Add more wallets as needed (up to WALLET_5_*)
```

Alternatively, for simple usage with a single wallet:

```javascript
SENDER_PRIVATE_KEY=0xYourPrivateKeyHere
```

## Usage Examples

### Basic Bridge Transaction

Bridge 0.000001 USDC from Sepolia to Babylon:

```bash
node bridge.js --destination babylon --count 10
```

Bridge to Union Testnet:

```bash
node bridge.js --destination union --count 5
```

### Simulation Mode (No Real Transactions)

Test the process without sending actual transactions:

```bash
node bridge.js --destination babylon --count 3 --dryRun
```

### Control Processing Speed

Adjust the delay between transactions:

```bash
node bridge.js --destination babylon --count 10 --delay 3000
```

### Parallel Processing

When using multiple wallets, control the level of parallelism:

```bash
node bridge.js --destination union --count 20 --maxParallel 3
```

### Verbose Output

Show detailed logs during execution:

```bash
node bridge.js --destination babylon --count 5 --verbose
```

## Tracking Progress

Each wallet needs to complete 500 transactions to each destination chain. The script automatically tracks progress in a `transaction-counts.json` file.

### View Progress for All Wallets

```bash
node query-progress.js
```

### View Progress for a Specific Wallet

```bash
node query-progress.js 0x6D69099515560c642CD98a483c195976323a5b6a
```

### View Overall Summary

```bash
node query-progress.js --summary
```

## Command Options

Option Alias Description Default `--destination` `-d` Destination chain (babylon/union) _Required_ `--source` `-s` Source chain sepolia `--token` `-t` Token to bridge usdc `--amount` `-a` Amount to bridge 0.000001 `--count` `-c` Number of transactions per wallet 1 `--delay` `-dl` Delay between transactions (ms) 5000 `--maxParallel` Maximum parallel wallet executions 3 `--dryRun` Simulate without sending false `--verbose` `-v` Show detailed logs false `--skipHealthCheck` Skip RPC health check false

## Advanced Features

- **Multi-wallet Support**: Configure up to 5 wallets with their own destination addresses
- **Parallel Processing**: Transactions from different wallets execute in parallel
- **Smart Nonce Management**: Prevents nonce conflicts for reliable transaction processing
- **RPC Health Checks**: Automatically selects the most reliable RPC endpoints
- **Detailed Transaction Logs**: All transactions are recorded for easy auditing

## Notes

- When using a single wallet, transactions are processed sequentially to ensure proper nonce ordering
- With multiple wallets, transactions are processed in parallel across different wallets
- The script automatically handles connection issues and retries failed transactions

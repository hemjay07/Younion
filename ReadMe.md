# Bridge Automation Tool

A streamlined tool for automating token bridge transactions between Sepolia and destination chains (Babylon Testnet and Union Testnet).

## Installation

1. **Clone this repository**
2. **Install dependencies**

```bash
   npm install
```

3. **Set up your private key**

- Create a `.env` file with your private key:

```javascript
     SENDER_PRIVATE_KEY=0xYourPrivateKeyHere
```

- Or create a `sender-keys.txt` file with multiple keys (one per line)

## Usage Examples

### Basic Bridge Transaction

Bridge 0.000001 USDC from Sepolia to Babylon:

```bash
node bridge.js --destination babylon --receiver bbn1hvctyj6tcw8tlxkv97p5k60cprr3ypyujdax
```

Bridge to Union Testnet:

```bash
node bridge.js --destination union --receiver union1uax6wtg8ue068l2hqhesecfhufn74xcz6cel6m
```

### Simulation Mode (No Real Transactions)

Test the process without sending actual transactions:

```bash
node bridge.js --destination babylon --receiver bbn1hvctyj6tcw8tlxkv97p5k60cprr3ypyujdax --count 3 --dryRun
```

### Multiple Transactions

Send 10 transactions with 5 second delay between each:

```bash
node bridge.js --destination babylon --receiver bbn1uax6wtg8ue068l2hqhesecfhufn74xcz83fxtn --count 10 --delay 5000
```

### Using Multiple Wallets

Distribute 20 transactions across wallets in a file:

```bash
node bridge.js --destination union --receiver union1uax6wtg8ue068l2hqhesecfhufn74xcz6cel6m --senderKeyFile ./sender-keys.txt --count 20 --batchSize 5
```

### Verbose Output

Show detailed logs during execution:

```bash
node bridge.js --destination babylon --receiver bbn1hvctyj6tcw8tlxkv97p5k60cprr3ypyujdax --count 20 --verbose
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

Option Alias Description Default `--destination` `-d` Destination chain (babylon/union) _Required_ `--receiver` `-r` Receiver address _Required_ `--source` `-s` Source chain sepolia `--token` `-t` Token to bridge usdc `--amount` `-a` Amount to bridge 0.000001 `--count` `-c` Number of transactions 1 `--batchSize` `-b` Transactions per batch 5 `--delay` `-dl` Delay between transactions (ms) 5000 `--senderKey` `-sk` Sender private key _From .env_ `--senderKeyFile` `-skf` File with private keys _None_ `--dryRun` Simulate without sending false `--verbose` `-v` Show detailed logs false

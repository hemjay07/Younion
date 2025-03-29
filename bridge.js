// bridge.js
const { ethers } = require("ethers");
const dotenv = require("dotenv");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const fs = require("fs");
const path = require("path");
const chains = require("./config/chains");
const tokens = require("./config/tokens");

// Load the transaction counter
const TransactionCounter = require("./transaction-counter");
const counter = new TransactionCounter();

// Load environment variables
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option("source", {
    alias: "s",
    description: "Source chain",
    type: "string",
    default: "sepolia",
    choices: ["sepolia"],
  })
  .option("destination", {
    alias: "d",
    description: "Destination chain",
    type: "string",
    choices: ["babylon", "union"],
    demandOption: true,
  })
  .option("token", {
    alias: "t",
    description: "Token to bridge",
    type: "string",
    default: "usdc",
  })
  .option("amount", {
    alias: "a",
    description: "Amount to bridge",
    type: "string",
    default: "0.000001",
  })
  .option("senderKey", {
    alias: "sk",
    description: "Sender private key (or use .env file)",
    type: "string",
  })
  .option("senderKeyFile", {
    alias: "skf",
    description: "File containing sender private keys (one per line)",
    type: "string",
  })
  .option("receiver", {
    alias: "r",
    description: "Receiver address",
    type: "string",
    demandOption: true,
  })
  .option("count", {
    alias: "c",
    description: "Number of transactions to send",
    type: "number",
    default: 1,
  })
  .option("batchSize", {
    alias: "b",
    description: "Number of transactions per batch",
    type: "number",
    default: 5,
  })
  .option("delay", {
    alias: "dl",
    description: "Delay between transactions in ms",
    type: "number",
    default: 5000,
  })
  .option("dryRun", {
    description: "Simulate transactions without sending",
    type: "boolean",
    default: false,
  })
  .option("verbose", {
    alias: "v",
    description: "Show verbose output",
    type: "boolean",
    default: false,
  })
  .help()
  .alias("help", "h")
  .parse();

// Helper function to wait/sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal logging function that respects verbose mode
function log(message, forceShow = false) {
  if (argv.verbose || forceShow) {
    console.log(message);
  }
}

// Always log errors
function logError(message) {
  console.error(message);
}

// Load sender private keys
const loadSenderKeys = () => {
  const keys = [];

  // Add key from command line if provided
  if (argv.senderKey) {
    keys.push(argv.senderKey);
  }

  // Add key from .env if available
  if (process.env.SENDER_PRIVATE_KEY) {
    keys.push(process.env.SENDER_PRIVATE_KEY);
  }

  // Add keys from file if provided
  if (argv.senderKeyFile && fs.existsSync(argv.senderKeyFile)) {
    const fileContent = fs.readFileSync(argv.senderKeyFile, "utf8");
    const fileKeys = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.startsWith("0x") && line.length >= 64);
    keys.push(...fileKeys);
  }

  // Remove duplicates
  return [...new Set(keys)];
};

// Get wallet from private key
const getWallet = (privateKey, provider) => {
  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    logError(`Failed to create wallet: ${error.message}`);
    throw error;
  }
};

// Try to connect to an RPC provider with fallbacks
async function connectToRPC(rpcUrls) {
  if (!Array.isArray(rpcUrls)) {
    rpcUrls = [rpcUrls];
  }

  // Add default fallbacks if not enough provided
  if (rpcUrls.length < 2) {
    rpcUrls = [
      ...rpcUrls,
      "https://ethereum-sepolia.publicnode.com",
      "https://rpc.sepolia.org",
      "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161", // Public Infura key
    ];
  }

  for (const url of rpcUrls) {
    try {
      log(`Trying to connect to RPC: ${url}`, true);

      // Create provider with batching disabled
      const provider = new ethers.JsonRpcProvider(url, undefined, {
        batchMaxCount: 1, // Disable batching to avoid free tier limits
        polling: true,
        pollingInterval: 4000, // Increase polling interval to reduce requests
        staticNetwork: true, // Avoid extra getNetwork calls
      });

      // Test the connection with a simple call
      const blockNumber = await provider.getBlockNumber();
      log(`Successfully connected to ${url} (Block #${blockNumber})`, true);

      return provider;
    } catch (error) {
      logError(`Failed to connect to RPC ${url}: ${error.message}`);
    }
  }

  throw new Error(
    "Failed to connect to any RPC provider. Please try again later."
  );
}

// Execute a bridge transaction
async function executeBridgeTransaction(params) {
  const {
    sourceChain,
    destinationChain,
    token,
    amount,
    senderKey,
    receiverAddress,
    batchId,
    transactionIndex,
  } = params;

  try {
    log(
      `\n[${new Date().toISOString()}] Starting bridge transaction ${
        transactionIndex + 1
      } in batch ${batchId}`
    );
    log(`From: ${sourceChain.name} To: ${destinationChain.name}`);
    log(`Token: ${token.symbol} (${token.address})`);
    log(`Amount: ${amount}`);
    log(`Receiver: ${receiverAddress}`);

    // Verify receiver address format matches destination chain
    if (
      destinationChain.name.toLowerCase().includes("babylon") &&
      !receiverAddress.startsWith("bbn")
    ) {
      throw new Error(
        `Invalid receiver address format for Babylon: ${receiverAddress}. Address should start with 'bbn'`
      );
    }

    if (
      destinationChain.name.toLowerCase().includes("union") &&
      !receiverAddress.startsWith("union")
    ) {
      throw new Error(
        `Invalid receiver address format for Union: ${receiverAddress}. Address should start with 'union'`
      );
    }

    // Connect to the network with improved error handling
    let rpcUrls = [sourceChain.rpcUrl];
    if (sourceChain.alternativeRpcUrls) {
      rpcUrls = rpcUrls.concat(sourceChain.alternativeRpcUrls);
    }

    const provider = await connectToRPC(rpcUrls);
    const wallet = getWallet(senderKey, provider);
    log(`Connected with address: ${wallet.address}`);

    // Convert amount to smallest unit
    const amountInSmallestUnit = ethers.parseUnits(amount, token.decimals);
    log(`Amount in smallest unit: ${amountInSmallestUnit}`);

    // Add a small delay between operations to avoid rate limiting
    await sleep(500);

    // Create token contract instance
    const tokenABI = [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ];
    const tokenContract = new ethers.Contract(token.address, tokenABI, wallet);

    // Check balances
    const ethBalance = await provider.getBalance(wallet.address);
    log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

    // Add a small delay between operations
    await sleep(500);

    // Check token balance
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    log(
      `Token balance: ${ethers.formatUnits(tokenBalance, token.decimals)} ${
        token.symbol
      }`
    );

    // Validate balances
    if (ethBalance < ethers.parseEther(sourceChain.ethValue)) {
      throw new Error(`Insufficient ETH balance for wallet ${wallet.address}`);
    }

    if (tokenBalance < amountInSmallestUnit) {
      throw new Error(
        `Insufficient ${token.symbol} balance for wallet ${wallet.address}`
      );
    }

    // Add a small delay between operations
    await sleep(500);

    // Check and approve token allowance if needed
    const allowance = await tokenContract.allowance(
      wallet.address,
      sourceChain.contractAddress
    );
    log(`Token allowance: ${ethers.formatUnits(allowance, token.decimals)}`);

    if (allowance < amountInSmallestUnit) {
      log("Approving token spending...");

      if (argv.dryRun) {
        log("[DRY RUN] Would approve token spending");
      } else {
        const approveTx = await tokenContract.approve(
          sourceChain.contractAddress,
          amountInSmallestUnit
        );
        log(`Approval transaction submitted: ${approveTx.hash}`);

        log("Waiting for approval confirmation...");
        const approveReceipt = await approveTx.wait();
        log(`Approval confirmed in block ${approveReceipt.blockNumber}`);
      }
    } else {
      log("Sufficient allowance already granted");
    }

    // Add a small delay between operations
    await sleep(500);

    // Prepare transaction data
    const functionSelector = "0x7d8ec568"; // Function selector for bridge
    const salt = ethers.randomBytes(32);

    // Format receiver address as bytes
    const receiverBytes = Buffer.from(receiverAddress);

    // Create appropriate backup receivers based on destination chain
    let backupReceiver1, backupReceiver2;

    if (destinationChain.name.toLowerCase().includes("babylon")) {
      // Babylon backup receivers from the UI transaction
      backupReceiver1 = Buffer.from(
        "bbn168fft4g777vnf9880plpehj2fzwjkeedc0c2s389eqa3cngh4s6scetjaz"
      );
      backupReceiver2 = Buffer.from(
        "bbn1248rv43kw0s60vkysgs2uumrr8u7wmcaxf6fuswt3p806u32xrwqnq62t8"
      );
      log(`Using Babylon backup receivers for ${destinationChain.name}`, true);
    } else {
      // Union backup receivers
      backupReceiver1 = Buffer.from(
        "union1uax6wtg8ue068l2hqhesecfhufn74xcz6cel6m"
      );
      backupReceiver2 = Buffer.from(
        "union13pxktu2hk8pseksaaka54ngxyfmpjljrleh3cc8sxvq4dxalvttqdmdgv5"
      );
      log(`Using Union backup receivers for ${destinationChain.name}`, true);
    }

    // Debug info
    log(`=== TRANSACTION DEBUG INFO ===`, true);
    log(`Destination Chain: ${destinationChain.name}`, true);
    log(`sourceChannelId: ${destinationChain.sourceChannelId}`, true);
    log(`Primary Receiver: ${receiverAddress}`, true);
    log(`Backup Receiver 1: ${backupReceiver1.toString()}`, true);
    log(`Backup Receiver 2: ${backupReceiver2.toString()}`, true);
    log(`===============================`, true);

    // Encode parameters
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedParams = abiCoder.encode(
      [
        "uint64", // sourceChannelId
        "bytes", // receiver primary
        "address", // baseToken
        "uint256", // baseAmount
        "bytes", // receiverBackup1
        "uint256", // quoteAmount
        "uint64", // timeoutHeight
        "uint64", // timeoutTimestamp
        "bytes32", // salt
        "bytes", // receiverBackup2
      ],
      [
        destinationChain.sourceChannelId,
        receiverBytes, // Primary receiver
        token.address,
        amountInSmallestUnit,
        backupReceiver1, // Backup receiver 1
        amountInSmallestUnit,
        0, // timeoutHeight
        "0xfffffffffffffffa", // timeoutTimestamp
        salt,
        backupReceiver2, // Backup receiver 2
      ]
    );

    // Create transaction data
    const data = functionSelector + encodedParams.slice(2);

    // Debug transaction data
    log(`=== TRANSACTION DATA ===`, true);
    log(`TX Data: ${data}`, true);
    log(`========================`, true);

    // Create and send transaction
    const tx = {
      to: sourceChain.contractAddress,
      data,
      value: ethers.parseEther(sourceChain.ethValue),
      gasLimit: 300000, // Based on previous successful transaction + buffer
    };

    let txHash, txReceipt;

    if (argv.dryRun) {
      log("[DRY RUN] Would send transaction");
      txHash =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      txReceipt = { status: 1 };

      // Update counter in dry run mode
      counter.recordTransaction(wallet.address, destinationChain.name, true);
    } else {
      // Show minimal info about transaction being sent
      log(
        `Sending transaction from ${wallet.address.substring(0, 8)}... to ${
          destinationChain.name
        }...`,
        true
      );

      const txResponse = await wallet.sendTransaction(tx);
      txHash = txResponse.hash;
      log(`Transaction submitted: ${txHash}`);

      log("Waiting for confirmation...");
      txReceipt = await txResponse.wait();

      // Show minimal confirmation of success
      log(`Transaction ${txHash.substring(0, 8)}... confirmed!`, true);

      // Record the transaction result silently
      if (txReceipt.status === 1) {
        counter.recordTransaction(wallet.address, destinationChain.name, true);
      } else {
        counter.recordTransaction(wallet.address, destinationChain.name, false);
        logError(`Transaction failed: ${txHash}`);
      }
    }

    return {
      success: txReceipt.status === 1,
      txHash,
      from: wallet.address,
      to: receiverAddress,
    };
  } catch (error) {
    logError(`Bridge transaction failed: ${error.message}`);

    // Try to record failed transaction if we have the wallet address
    if (params.senderKey) {
      try {
        // Try to create a minimal provider just for this operation
        const provider = new ethers.JsonRpcProvider(
          "https://ethereum-sepolia.publicnode.com",
          undefined,
          {
            batchMaxCount: 1,
          }
        );
        const wallet = getWallet(params.senderKey, provider);

        counter.recordTransaction(
          wallet.address,
          params.destinationChain.name,
          false
        );
      } catch (innerError) {
        logError(`Could not record failure: ${innerError.message}`);
      }
    }

    return {
      success: false,
      error: error.message,
    };
  }
}
// Execute a batch of transactions
async function executeBatch(params) {
  const {
    sourceChain,
    destinationChain,
    token,
    amount,
    senderKeys,
    receiverAddress,
    count,
    batchSize,
    delay,
    batchId,
  } = params;

  log(
    `\n===== Starting batch ${batchId} with ${count} transactions =====`,
    true
  );

  const results = {
    total: count,
    successful: 0,
    failed: 0,
    transactions: [],
  };

  // Round-robin through sender keys
  for (let i = 0; i < count; i++) {
    const senderKey = senderKeys[i % senderKeys.length];

    try {
      const result = await executeBridgeTransaction({
        sourceChain,
        destinationChain,
        token,
        amount,
        senderKey,
        receiverAddress,
        batchId,
        transactionIndex: i,
      });

      results.transactions.push(result);

      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
      }

      // Wait between transactions to avoid rate limiting
      if (i < count - 1) {
        log(`Waiting ${delay}ms before next transaction...`);
        await sleep(delay);
      }
    } catch (error) {
      logError(`Error executing transaction ${i + 1}: ${error.message}`);
      results.failed++;
      results.transactions.push({
        success: false,
        error: error.message,
      });

      // Wait between transactions even on error
      if (i < count - 1) {
        log(`Waiting ${delay}ms before next transaction...`);
        await sleep(delay);
      }
    }
  }

  log(
    `\n===== Batch ${batchId} completed: ${results.successful} successful, ${results.failed} failed =====`,
    true
  );
  return results;
}

// Main function
async function main() {
  try {
    // Validate arguments
    if (!chains[argv.source]) {
      throw new Error(`Unknown source chain: ${argv.source}`);
    }

    if (!chains[argv.destination]) {
      throw new Error(`Unknown destination chain: ${argv.destination}`);
    }

    if (!tokens[argv.token]) {
      throw new Error(`Unknown token: ${argv.token}`);
    }

    // Load sender keys
    const senderKeys = loadSenderKeys();
    if (senderKeys.length === 0) {
      throw new Error(
        "No sender private keys provided. Use --senderKey, --senderKeyFile, or set SENDER_PRIVATE_KEY in .env"
      );
    }

    log(`Loaded ${senderKeys.length} sender keys`, true);

    // Get chain and token configurations
    const sourceChain = chains[argv.source];
    const destinationChain = chains[argv.destination];
    const token = tokens[argv.token];

    // Calculate number of batches
    const totalTransactions = argv.count;
    const batchSize = argv.batchSize;
    const numBatches = Math.ceil(totalTransactions / batchSize);

    log(`\n===== BRIDGE AUTOMATION STARTING =====`, true);
    log(
      `Total transactions: ${totalTransactions} in ${numBatches} batches`,
      true
    );
    log(`From: ${sourceChain.name} To: ${destinationChain.name}`, true);
    log(`Token: ${token.symbol} (${token.address})`, true);
    log(`Amount per transaction: ${argv.amount}`, true);
    log(`Receiver address: ${argv.receiver}`, true);

    // Execute batches
    const batchResults = [];

    for (let i = 0; i < numBatches; i++) {
      const batchId = `${i + 1}`;
      const batchCount = Math.min(batchSize, totalTransactions - i * batchSize);

      log(
        `\nStarting batch ${
          i + 1
        } of ${numBatches} with ${batchCount} transactions`,
        true
      );

      const batchResult = await executeBatch({
        sourceChain,
        destinationChain,
        token,
        amount: argv.amount,
        senderKeys,
        receiverAddress: argv.receiver,
        count: batchCount,
        batchSize,
        delay: argv.delay,
        batchId,
      });

      batchResults.push(batchResult);

      // Wait between batches
      if (i < numBatches - 1) {
        const batchDelay = argv.delay * 2; // Longer delay between batches
        log(
          `\nBatch ${
            i + 1
          } completed. Waiting ${batchDelay}ms before next batch...`,
          true
        );
        await sleep(batchDelay);
      }
    }

    // Summarize results
    const totalSuccessful = batchResults.reduce(
      (sum, batch) => sum + batch.successful,
      0
    );
    const totalFailed = batchResults.reduce(
      (sum, batch) => sum + batch.failed,
      0
    );

    log("\n===== BRIDGE AUTOMATION COMPLETED =====", true);
    log(`Total transactions: ${totalTransactions}`, true);
    log(`Successful: ${totalSuccessful}`, true);
    log(`Failed: ${totalFailed}`, true);
    log(
      `Success rate: ${((totalSuccessful / totalTransactions) * 100).toFixed(
        2
      )}%`,
      true
    );

    // Inform user how to check progress
    log(`\nTo check progress for all wallets: node query-progress.js`, true);
    log(
      `To check progress for a specific wallet: node query-progress.js <wallet-address>`,
      true
    );
  } catch (error) {
    logError(`Bridge automation failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
if (require.main === module) {
  main()
    .then(() => {
      log("\nBridge automation completed successfully", true);
      process.exit(0);
    })
    .catch((error) => {
      logError(`\nBridge automation failed: ${error.stack}`);
      process.exit(1);
    });
}

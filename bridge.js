// bridge.js
const { ethers } = require("ethers");
const dotenv = require("dotenv");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const fs = require("fs");
const path = require("path");
const chains = require("./config/chains");
const tokens = require("./config/tokens");
const { sleep, recordTransaction } = require("./utils/transactions");
const { getWallet, checkWalletBalance } = require("./utils/wallets");

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
  .option("suppressConnectionLogs", {
    description: "Suppress internal connection logs",
    type: "boolean",
    default: true,
  })
  .option("skipHealthCheck", {
    description: "Skip RPC health check",
    type: "boolean",
    default: false,
  })
  .help()
  .alias("help", "h")
  .parse();

// Provider cache to avoid creating new connections
const providerCache = new Map();

// Suppress internal ethers.js connection logs if requested
if (argv.suppressConnectionLogs) {
  const originalConsoleLog = console.log;
  console.log = function () {
    const msg = arguments[0];
    if (
      typeof msg === "string" &&
      (msg.includes("JsonRpcProvider failed to detect network") ||
        msg.includes("getNetwork") ||
        msg.includes("retry in"))
    ) {
      // Suppress these messages
      return;
    }
    originalConsoleLog.apply(console, arguments);
  };
}

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

// Simple progress indicator
function showProgress(message) {
  if (!argv.verbose) return { complete: () => {} };

  process.stdout.write(`${message}... `);

  const spinner = ["|", "/", "-", "\\"];
  let i = 0;

  const intervalId = setInterval(() => {
    process.stdout.write(`\b${spinner[i++ % spinner.length]}`);
  }, 100);

  return {
    complete: (completionMessage) => {
      clearInterval(intervalId);
      process.stdout.write(`\b${completionMessage}\n`);
    },
  };
}

// Helper function to handle promises with timeout
async function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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

// Helper function to check if an error is related to connection issues
function isConnectionError(errorMsg) {
  if (!errorMsg) return false;

  const connectionErrorPatterns = [
    "502",
    "503",
    "504",
    "429",
    "timeout",
    "timed out",
    "network error",
    "connection",
    "CONNECTION_ERROR",
    "SERVER_ERROR",
    "Bad Gateway",
    "Gateway Timeout",
    "Service Unavailable",
    "Too Many Requests",
  ];

  return connectionErrorPatterns.some((pattern) =>
    errorMsg.toString().toLowerCase().includes(pattern.toLowerCase())
  );
}

// Perform a health check on RPC endpoints to identify the most reliable ones
async function performRpcHealthCheck(rpcUrls, quickCheck = false) {
  if (!Array.isArray(rpcUrls)) {
    rpcUrls = [rpcUrls];
  }

  log("Performing RPC health check...", true);

  // For quick checks, only check the first few RPCs
  if (quickCheck && rpcUrls.length > 3) {
    rpcUrls = rpcUrls.slice(0, 3);
    log(`Quick check mode: only checking first 3 RPCs`, true);
  }

  const results = [];

  // Add timeout for each health check
  const checkPromises = rpcUrls.map(async (url) => {
    try {
      const startTime = Date.now();

      // Create provider with minimal configuration and explicit network
      const provider = new ethers.JsonRpcProvider(
        url,
        {
          name: "sepolia",
          chainId: 11155111,
        },
        {
          batchMaxCount: 1,
          polling: false,
          staticNetwork: true,
          maxRetries: 1,
        }
      );

      // Use Promise.race with a timeout
      const blockNumber = await withTimeout(
        provider.getBlockNumber(),
        5000,
        `RPC call to ${url} timed out after 5000ms`
      );

      const responseTime = Date.now() - startTime;

      return {
        url,
        status: "healthy",
        responseTime,
        blockNumber,
      };
    } catch (error) {
      return {
        url,
        status: "unhealthy",
        error: error.message,
      };
    }
  });

  // Execute all checks in parallel
  const checkResults = await Promise.all(checkPromises);
  results.push(...checkResults);

  // Sort results by status (healthy first) and response time
  results.sort((a, b) => {
    if (a.status === "healthy" && b.status !== "healthy") return -1;
    if (a.status !== "healthy" && b.status === "healthy") return 1;
    if (a.status === "healthy" && b.status === "healthy") {
      return a.responseTime - b.responseTime;
    }
    return 0;
  });

  // Log results
  for (const result of results) {
    if (result.status === "healthy") {
      log(
        `RPC ${result.url} is healthy (${result.responseTime}ms, block #${result.blockNumber})`,
        true
      );
    } else {
      log(`RPC ${result.url} is unhealthy: ${result.error}`, true);
    }
  }

  return results;
}

// Try to connect to an RPC provider with fallbacks and exponential backoff
async function connectToRPC(rpcUrls, maxRetries = 3, forceRefresh = false) {
  if (!Array.isArray(rpcUrls)) {
    rpcUrls = [rpcUrls];
  }

  // Check cache first if not forcing refresh
  if (!forceRefresh) {
    for (const url of rpcUrls) {
      const cachedProvider = providerCache.get(url);
      if (cachedProvider) {
        try {
          // Verify the cached provider is still working
          await withTimeout(
            cachedProvider.getBlockNumber(),
            3000,
            "Cached provider verification timeout"
          );
          log(`Using cached provider for ${url}`, true);
          return cachedProvider;
        } catch (error) {
          // Provider is stale, remove from cache
          providerCache.delete(url);
          log(`Cached provider for ${url} is stale, reconnecting...`, true);
        }
      }
    }
  }

  // Add default fallbacks if not enough provided
  if (rpcUrls.length < 2) {
    rpcUrls = [
      ...rpcUrls,
      "https://ethereum-sepolia.publicnode.com",
      "https://rpc.sepolia.org",
    ];
  }

  // Outer loop for RPC URLs
  for (const url of rpcUrls) {
    // Inner loop for retries on the same URL
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log(
          `Trying to connect to RPC: ${url} (attempt ${attempt}/${maxRetries})`,
          true
        );

        // Create provider with improved settings and explicit network
        const provider = new ethers.JsonRpcProvider(
          url,
          {
            name: "sepolia",
            chainId: 11155111,
          },
          {
            batchMaxCount: 1, // Disable batching to avoid free tier limits
            polling: false, // Disable polling to reduce connection attempts
            staticNetwork: true, // Avoid extra getNetwork calls
            cacheTimeout: 0, // Disable cache for critical operations
            maxRetries: 1, // Reduce internal retries
            allowGzip: true, // Enable compression if supported
          }
        );

        // Test the connection with a simple call
        const blockNumber = await withTimeout(
          provider.getBlockNumber(),
          5000,
          `RPC call to ${url} timed out after 5000ms`
        );

        log(`Successfully connected to ${url} (Block #${blockNumber})`, true);

        // Add a property to track the RPC URL this provider is using
        provider.rpcUrl = url;

        // Cache the provider for future use
        providerCache.set(url, provider);

        return provider;
      } catch (error) {
        const errorMsg = error.message || "Unknown error";

        // Check for specific error messages that indicate we should try a different RPC
        const fatalErrors = [
          "network does not support",
          "invalid project id",
          "unauthorized",
          "exceeded maximum",
          "rate limit",
        ];

        const isFatalError = fatalErrors.some((msg) =>
          errorMsg.toLowerCase().includes(msg.toLowerCase())
        );

        if (isFatalError) {
          logError(
            `Fatal error with RPC ${url}: ${errorMsg}. Trying next RPC.`
          );
          break; // Exit inner retry loop, move to next RPC
        }

        if (attempt === maxRetries) {
          logError(
            `Failed to connect to RPC ${url} after ${maxRetries} attempts: ${errorMsg}`
          );
        } else {
          // Only for non-fatal errors, retry with backoff
          const backoffTime = Math.min(
            1000 * Math.pow(1.5, attempt - 1),
            10000
          );
          log(
            `RPC connection failed (${errorMsg}). Retrying in ${backoffTime}ms...`
          );
          await sleep(backoffTime);
        }
      }
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

  let provider = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  let lastProvider = null; // For caching

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

    // Function to handle RPC operations with reconnection logic
    async function executeWithReconnect(operation) {
      while (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        try {
          // Ensure we have a provider, reuse if possible
          if (!provider && lastProvider) {
            try {
              // Try to reuse the last provider
              await withTimeout(
                lastProvider.getBlockNumber(),
                3000,
                "Provider reuse verification timeout"
              );
              provider = lastProvider;
              log(`Reusing last working provider`, true);
            } catch (error) {
              // Last provider is not working, get a new one
              provider = await connectToRPC(rpcUrls);
              lastProvider = provider;
            }
          } else if (!provider) {
            provider = await connectToRPC(rpcUrls);
            lastProvider = provider;
          }

          // Execute the operation
          return await operation(provider);
        } catch (error) {
          // Check if this is an RPC connection error
          if (isConnectionError(error.message)) {
            reconnectAttempts++;
            logError(`RPC connection error: ${error.message}`);

            if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
              log(
                `Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
              );
              // Reset provider to force reconnection
              provider = null;
              // Add a delay before reconnecting
              await sleep(2000 * reconnectAttempts);
            } else {
              throw new Error(
                `Max reconnection attempts reached: ${error.message}`
              );
            }
          } else {
            // Not a connection error, rethrow
            throw error;
          }
        }
      }
    }

    // Use our reconnection wrapper for all provider operations
    provider = await executeWithReconnect(async () => {
      return await connectToRPC(rpcUrls);
    });

    lastProvider = provider; // Save for potential reuse

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

    // Check balances with reconnection logic
    const progressBalances = showProgress("Checking wallet balances");
    const ethBalance = await executeWithReconnect(async (provider) => {
      return await provider.getBalance(wallet.address);
    });
    progressBalances.complete("Done");

    log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

    // Add a small delay between operations
    await sleep(500);

    // Check token balance with reconnection logic
    const progressTokens = showProgress("Checking token balance");
    const tokenBalance = await executeWithReconnect(async () => {
      return await tokenContract.balanceOf(wallet.address);
    });
    progressTokens.complete("Done");

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

    // Check and approve token allowance if needed with reconnection logic
    const progressAllowance = showProgress("Checking token allowance");
    const allowance = await executeWithReconnect(async () => {
      return await tokenContract.allowance(
        wallet.address,
        sourceChain.contractAddress
      );
    });
    progressAllowance.complete("Done");

    log(`Token allowance: ${ethers.formatUnits(allowance, token.decimals)}`);

    if (allowance < amountInSmallestUnit) {
      log("Approving token spending...");

      if (argv.dryRun) {
        log("[DRY RUN] Would approve token spending");
      } else {
        const progressApprove = showProgress("Sending approval transaction");
        const approveTx = await executeWithReconnect(async () => {
          return await tokenContract.approve(
            sourceChain.contractAddress,
            amountInSmallestUnit
          );
        });
        progressApprove.complete("Sent");

        log(`Approval transaction submitted: ${approveTx.hash}`);

        const progressConfirm = showProgress(
          "Waiting for approval confirmation"
        );
        const approveReceipt = await executeWithReconnect(async () => {
          return await approveTx.wait();
        });
        progressConfirm.complete("Confirmed");

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

      // Send transaction with reconnection logic
      const progressSend = showProgress("Sending bridge transaction");
      const txResponse = await executeWithReconnect(async () => {
        return await wallet.sendTransaction(tx);
      });
      progressSend.complete("Sent");

      txHash = txResponse.hash;
      log(`Transaction submitted: ${txHash}`);

      log("Waiting for confirmation...");

      // Wait for confirmation with reconnection logic
      const progressConfirm = showProgress(
        "Waiting for transaction confirmation"
      );
      txReceipt = await executeWithReconnect(async () => {
        return await txResponse.wait();
      });
      progressConfirm.complete("Confirmed");

      // Show minimal confirmation of success
      log(`Transaction ${txHash.substring(0, 8)}... confirmed!`, true);

      // Record the transaction result silently
      if (txReceipt.status === 1) {
        counter.recordTransaction(wallet.address, destinationChain.name, true);

        // Record detailed transaction info
        await recordTransaction({
          txHash,
          from: wallet.address,
          to: receiverAddress,
          token: token.symbol,
          amount,
          sourceChain: sourceChain.name,
          destinationChain: destinationChain.name,
          status: "SUCCESS",
          blockNumber: txReceipt.blockNumber,
          gasUsed: txReceipt.gasUsed?.toString() || "0",
          batchId,
        });
      } else {
        counter.recordTransaction(wallet.address, destinationChain.name, false);
        logError(`Transaction failed: ${txHash}`);

        // Record failed transaction
        await recordTransaction({
          txHash,
          from: wallet.address,
          to: receiverAddress,
          token: token.symbol,
          amount,
          sourceChain: sourceChain.name,
          destinationChain: destinationChain.name,
          status: "FAILED",
          blockNumber: txReceipt.blockNumber,
          gasUsed: txReceipt.gasUsed?.toString() || "0",
          batchId,
        });
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
          {
            name: "sepolia",
            chainId: 11155111,
          },
          {
            batchMaxCount: 1,
            polling: false,
            staticNetwork: true,
          }
        );
        const wallet = getWallet(params.senderKey, provider);

        counter.recordTransaction(
          wallet.address,
          params.destinationChain.name,
          false
        );

        // Record detailed transaction failure
        await recordTransaction({
          txHash: "ERROR",
          from: wallet.address,
          to: receiverAddress,
          token: token.symbol,
          amount,
          sourceChain: sourceChain.name,
          destinationChain: destinationChain.name,
          status: "ERROR",
          blockNumber: 0,
          gasUsed: "0",
          batchId,
          error: error.message,
        });
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
    let attempts = 0;
    const maxAttempts = 3;
    let success = false;

    while (attempts < maxAttempts && !success) {
      attempts++;
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
          success = true;
        } else {
          // If it's not a connection error, don't retry
          if (!result.error || !isConnectionError(result.error)) {
            results.failed++;
            break;
          }

          // For connection errors, we retry
          logError(
            `Transaction attempt ${attempts}/${maxAttempts} failed with connection error. Retrying...`
          );

          // Wait longer before retrying
          await sleep(delay * attempts);
        }
      } catch (error) {
        logError(
          `Error executing transaction ${
            i + 1
          } (attempt ${attempts}/${maxAttempts}): ${error.message}`
        );

        // If it's not a connection error, don't retry
        if (!isConnectionError(error.message)) {
          results.failed++;
          results.transactions.push({
            success: false,
            error: error.message,
          });
          break;
        }

        // For the last attempt, record the failure
        if (attempts === maxAttempts) {
          results.failed++;
          results.transactions.push({
            success: false,
            error: error.message,
          });
        }

        // Wait longer before retrying
        await sleep(delay * attempts);
      }
    }

    // Wait between transactions
    if (i < count - 1) {
      log(`Waiting ${delay}ms before next transaction...`);
      await sleep(delay);
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

    // Perform RPC health check if not skipped
    if (!argv.skipHealthCheck) {
      // Collect RPC URLs
      let rpcUrls = [sourceChain.rpcUrl];
      if (sourceChain.alternativeRpcUrls) {
        rpcUrls = rpcUrls.concat(sourceChain.alternativeRpcUrls);
      }

      // Add more public RPCs for health check
      rpcUrls = [
        ...rpcUrls,
        "https://ethereum-sepolia.publicnode.com",
        "https://rpc.sepolia.org",
        "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161", // Public Infura key
        "https://eth-sepolia.g.alchemy.com/v2/demo", // Alchemy public key
      ];

      // Remove duplicates
      rpcUrls = [...new Set(rpcUrls)];

      const healthResults = await performRpcHealthCheck(rpcUrls);

      // Update the chain config with ordered RPC URLs based on health check
      const healthyRpcs = healthResults
        .filter((result) => result.status === "healthy")
        .map((result) => result.url);

      if (healthyRpcs.length > 0) {
        sourceChain.rpcUrl = healthyRpcs[0]; // Set primary RPC to healthiest
        sourceChain.alternativeRpcUrls = healthyRpcs.slice(1); // Set rest as alternatives

        // Pre-create and cache a provider for the primary RPC
        try {
          const primaryProvider = new ethers.JsonRpcProvider(
            sourceChain.rpcUrl,
            {
              name: "sepolia",
              chainId: 11155111,
            },
            {
              batchMaxCount: 1,
              polling: false,
              staticNetwork: true,
            }
          );

          // Warm up the provider
          await withTimeout(
            primaryProvider.getBlockNumber(),
            5000,
            "Provider warm-up timeout"
          );
          providerCache.set(sourceChain.rpcUrl, primaryProvider);
          log(`Pre-cached primary provider for ${sourceChain.rpcUrl}`, true);
        } catch (error) {
          log(`Failed to pre-cache provider: ${error.message}`, true);
        }

        log(`Using primary RPC: ${sourceChain.rpcUrl}`, true);
        log(
          `Available backup RPCs: ${sourceChain.alternativeRpcUrls.length}`,
          true
        );
      } else {
        log(
          "Warning: No healthy RPCs found in health check. Proceeding with original configuration.",
          true
        );
      }
    } else {
      log("RPC health check skipped as requested", true);
    }

    // Calculate number of batches
    const totalTransactions = argv.count;
    const batchSize = Math.min(argv.batchSize, 10); // Limit batch size to 10 for stability
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

      // For large batches, do a quick RPC health check before starting
      if (!argv.skipHealthCheck && i > 0 && i % 5 === 0) {
        log("Performing quick RPC health check before next batch...", true);
        let rpcUrls = [sourceChain.rpcUrl];
        if (sourceChain.alternativeRpcUrls) {
          rpcUrls = rpcUrls.concat(sourceChain.alternativeRpcUrls);
        }

        const quickHealthResults = await performRpcHealthCheck(rpcUrls, true);
        const quickHealthyRpcs = quickHealthResults
          .filter((result) => result.status === "healthy")
          .map((result) => result.url);

        if (quickHealthyRpcs.length > 0) {
          sourceChain.rpcUrl = quickHealthyRpcs[0];
          sourceChain.alternativeRpcUrls = quickHealthyRpcs.slice(1);
          log(`Updated primary RPC to: ${sourceChain.rpcUrl}`, true);
        }
      }

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

        // For large numbers of transactions, perform additional RPC health checks
        if (!argv.skipHealthCheck && totalTransactions > 50 && i % 2 === 1) {
          log("Re-checking RPC health before next batch...", true);
          let rpcUrls = [sourceChain.rpcUrl];
          if (sourceChain.alternativeRpcUrls) {
            rpcUrls = rpcUrls.concat(sourceChain.alternativeRpcUrls);
          }

          const updatedHealthResults = await performRpcHealthCheck(
            rpcUrls,
            true
          );
          const updatedHealthyRpcs = updatedHealthResults
            .filter((result) => result.status === "healthy")
            .map((result) => result.url);

          if (updatedHealthyRpcs.length > 0) {
            sourceChain.rpcUrl = updatedHealthyRpcs[0];
            sourceChain.alternativeRpcUrls = updatedHealthyRpcs.slice(1);
            log(`Updated primary RPC to: ${sourceChain.rpcUrl}`, true);
          }
        }

        // Clear provider cache between batches to ensure fresh connections
        if (i % 3 === 2) {
          // Every third batch
          log("Clearing provider cache to ensure fresh connections", true);
          providerCache.clear();
        }
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

module.exports = {
  executeBridgeTransaction,
  executeBatch,
  connectToRPC,
  performRpcHealthCheck,
  isConnectionError,
};

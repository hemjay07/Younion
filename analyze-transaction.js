const { ethers } = require("ethers");
const dotenv = require("dotenv");
dotenv.config();

async function analyzeTransaction() {
  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org"
    );

    // Use the transaction hash from the GraphQL query
    const txHash =
      "0x3f98cfe30a81775e166606a9e6345b9a0375f7dd139b67ad1bf1603f97853e7c";

    // Get the transaction details
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      console.log(
        "Transaction not found. It might be too old or on a different network."
      );
      return;
    }

    console.log("Transaction Analysis:");
    console.log("-----------------------");
    console.log(`From: ${tx.from}`);
    console.log(`To: ${tx.to}`);
    console.log(`Value: ${ethers.formatEther(tx.value || 0)} ETH`);

    // Analyze the transaction data
    const data = tx.data;
    console.log(`Data: ${data}`);

    // Extract the function selector
    const functionSelector = data.substring(0, 10);
    console.log(`Function Selector: ${functionSelector}`);

    // Try to decode the parameters
    if (functionSelector === "0xbbe8cd03") {
      console.log("\nDecoding parameters for transferV2 function...");
      try {
        // Remove function selector
        const paramsData = "0x" + data.substring(10);

        // Define the parameter types
        const paramTypes = [
          "uint64", // sourceChannelId
          "bytes", // receiver
          "address", // baseToken
          "uint256", // baseAmount
          "address", // quoteToken
          "uint256", // quoteAmount
          "uint64", // timeoutHeight
          "uint64", // timeoutTimestamp
          "bytes32", // salt
          "address", // wethQuoteToken
        ];

        // Decode the parameters
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const decodedParams = abiCoder.decode(paramTypes, paramsData);

        // Display the decoded parameters
        console.log("Decoded Parameters:");
        console.log(`sourceChannelId: ${decodedParams[0]}`);

        // Convert receiver bytes to string
        const receiverBytes = decodedParams[1];
        console.log(
          `receiver (hex): 0x${Buffer.from(receiverBytes).toString("hex")}`
        );
        console.log(
          `receiver (utf8): ${Buffer.from(receiverBytes).toString()}`
        );

        console.log(`baseToken: ${decodedParams[2]}`);
        console.log(`baseAmount: ${decodedParams[3]}`);
        console.log(`quoteToken: ${decodedParams[4]}`);
        console.log(`quoteAmount: ${decodedParams[5]}`);
        console.log(`timeoutHeight: ${decodedParams[6]}`);
        console.log(`timeoutTimestamp: ${decodedParams[7]}`);
        console.log(`salt: 0x${Buffer.from(decodedParams[8]).toString("hex")}`);
        console.log(`wethQuoteToken: ${decodedParams[9]}`);

        // Get token information
        const tokenABI = [
          "function name() view returns (string)",
          "function symbol() view returns (string)",
          "function decimals() view returns (uint8)",
        ];

        const baseToken = new ethers.Contract(
          decodedParams[2],
          tokenABI,
          provider
        );
        try {
          const [name, symbol, decimals] = await Promise.all([
            baseToken.name(),
            baseToken.symbol(),
            baseToken.decimals(),
          ]);

          console.log("\nToken Information:");
          console.log(`Name: ${name}`);
          console.log(`Symbol: ${symbol}`);
          console.log(`Decimals: ${decimals}`);
          console.log(
            `Amount in ${symbol}: ${ethers.formatUnits(
              decodedParams[3],
              decimals
            )}`
          );
        } catch (error) {
          console.log("Could not get token information:", error.message);
        }

        // Now we have all the information needed to replicate this transaction!
        console.log("\nReplicate this transaction with:");
        console.log(`Token Address: ${decodedParams[2]}`);
        console.log(`WETH Address: ${decodedParams[9]}`);
        console.log(`Source Channel ID: ${decodedParams[0]}`);
        console.log(
          `Receiver Format: ${Buffer.from(receiverBytes).toString()}`
        );
      } catch (error) {
        console.log("Error decoding parameters:", error);
      }
    }

    // Also get the transaction receipt to see if it was successful
    const receipt = await provider.getTransactionReceipt(txHash);
    console.log(
      "\nTransaction Status:",
      receipt.status === 1 ? "Success" : "Failed"
    );
    console.log(`Gas Used: ${receipt.gasUsed}`);
    console.log(`Block Number: ${receipt.blockNumber}`);

    return {
      tx,
      receipt,
    };
  } catch (error) {
    console.error("Error analyzing transaction:", error);
  }
}

analyzeTransaction()
  .then(() => {
    console.log("\nAnalysis complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Analysis failed:", error);
    process.exit(1);
  });

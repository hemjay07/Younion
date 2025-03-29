// query-progress.js
const TransactionCounter = require("./transaction-counter");
const counter = new TransactionCounter();

// Helper function to format progress data
function formatProgress(walletData) {
  return {
    babylon: {
      completed: walletData.babylon.completed,
      remaining: walletData.babylon.remaining,
      failed: walletData.babylon.failed,
      percentComplete:
        ((walletData.babylon.completed / 500) * 100).toFixed(2) + "%",
    },
    union: {
      completed: walletData.union.completed,
      remaining: walletData.union.remaining,
      failed: walletData.union.failed,
      percentComplete:
        ((walletData.union.completed / 500) * 100).toFixed(2) + "%",
    },
  };
}

// Process command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log("\nUsage:");
  console.log(
    "  node query-progress.js                  - Show progress for all wallets"
  );
  console.log(
    "  node query-progress.js <wallet-address> - Show progress for specific wallet"
  );
  console.log(
    "  node query-progress.js --summary        - Show overall summary"
  );
  process.exit(0);
}

if (args[0] === "--summary") {
  // Show summary statistics
  const allWallets = counter.getAllWalletProgress();
  const walletCount = Object.keys(allWallets).length;

  let totalBabylonCompleted = 0;
  let totalBabylonFailed = 0;
  let totalUnionCompleted = 0;
  let totalUnionFailed = 0;

  for (const wallet of Object.values(allWallets)) {
    totalBabylonCompleted += wallet.babylon.completed;
    totalBabylonFailed += wallet.babylon.failed;
    totalUnionCompleted += wallet.union.completed;
    totalUnionFailed += wallet.union.failed;
  }

  console.log("\n===== BRIDGE TESTING SUMMARY =====");
  console.log(`Total Wallets: ${walletCount}`);
  console.log("\nBabylon Testnet:");
  console.log(`  Total Completed: ${totalBabylonCompleted}`);
  console.log(`  Total Failed: ${totalBabylonFailed}`);
  console.log(
    `  Overall Progress: ${(
      (totalBabylonCompleted / (500 * walletCount)) *
      100
    ).toFixed(2)}%`
  );

  console.log("\nUnion Testnet:");
  console.log(`  Total Completed: ${totalUnionCompleted}`);
  console.log(`  Total Failed: ${totalUnionFailed}`);
  console.log(
    `  Overall Progress: ${(
      (totalUnionCompleted / (500 * walletCount)) *
      100
    ).toFixed(2)}%`
  );

  console.log("\n==================================");
} else if (args[0]) {
  // Show progress for specific wallet
  const walletAddress = args[0];
  const progress = counter.getWalletProgress(walletAddress);

  console.log(`\nProgress for wallet: ${walletAddress}`);
  console.log(JSON.stringify(formatProgress(progress), null, 2));
} else {
  // Show progress for all wallets
  const allProgress = counter.getAllWalletProgress();

  console.log("\n===== BRIDGE TESTING PROGRESS =====");

  for (const [wallet, progress] of Object.entries(allProgress)) {
    console.log(`\nWallet: ${wallet}`);
    console.log(JSON.stringify(formatProgress(progress), null, 2));
  }

  console.log("\n==================================");
}

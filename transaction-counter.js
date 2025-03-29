// transaction-counter.js
const fs = require("fs");
const path = require("path");

class TransactionCounter {
  constructor() {
    this.dataFile = path.join(process.cwd(), "transaction-counts.json");
    this.counts = this.loadCounts();
  }

  // Load existing counts from file
  loadCounts() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`Error loading transaction counts: ${error.message}`);
    }
    return { wallets: {} };
  }

  // Save counts to file
  saveCounts() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.counts, null, 2));
    } catch (error) {
      console.error(`Error saving transaction counts: ${error.message}`);
    }
  }

  // Record a transaction (silently)
  recordTransaction(walletAddress, destinationChain, success = true) {
    // Initialize wallet if not exists
    if (!this.counts.wallets[walletAddress]) {
      this.counts.wallets[walletAddress] = {
        babylon: { completed: 0, failed: 0, remaining: 500 },
        union: { completed: 0, failed: 0, remaining: 500 },
      };
    }

    // Determine the chain key based on exact destination chain name
    let chainKey;
    if (typeof destinationChain === "string") {
      // Convert to lowercase for case-insensitive comparison
      const chainLower = destinationChain.toLowerCase();

      if (chainLower === "babylon testnet" || chainLower === "babylon") {
        chainKey = "babylon";
      } else if (chainLower === "union testnet" || chainLower === "union") {
        chainKey = "union";
      } else {
        // Default fallback (shouldn't happen with proper inputs)
        console.error(
          `Unknown destination chain: ${destinationChain}, defaulting to union`
        );
        chainKey = "union";
      }
    } else {
      // If destinationChain is an object with a name property
      const chainName = (destinationChain.name || "").toLowerCase();

      if (chainName.includes("babylon")) {
        chainKey = "babylon";
      } else if (chainName.includes("union")) {
        chainKey = "union";
      } else {
        console.error(
          `Unknown destination chain: ${chainName}, defaulting to union`
        );
        chainKey = "union";
      }
    }

    // Update counts
    if (success) {
      this.counts.wallets[walletAddress][chainKey].completed += 1;
      this.counts.wallets[walletAddress][chainKey].remaining -= 1;
    } else {
      this.counts.wallets[walletAddress][chainKey].failed += 1;
    }

    // Save updated counts
    this.saveCounts();

    return {
      wallet: walletAddress,
      chain: chainKey,
      completed: this.counts.wallets[walletAddress][chainKey].completed,
      failed: this.counts.wallets[walletAddress][chainKey].failed,
      remaining: this.counts.wallets[walletAddress][chainKey].remaining,
    };
  }

  // Get progress for a specific wallet
  getWalletProgress(walletAddress) {
    return (
      this.counts.wallets[walletAddress] || {
        babylon: { completed: 0, failed: 0, remaining: 500 },
        union: { completed: 0, failed: 0, remaining: 500 },
      }
    );
  }

  // Get all wallet progress
  getAllWalletProgress() {
    return this.counts.wallets;
  }
}

module.exports = TransactionCounter;

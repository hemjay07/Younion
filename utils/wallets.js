// utils/wallets.js
const { ethers } = require("ethers");
const logger = require("./logger");

// Get wallet from private key
const getWallet = (privateKey, provider) => {
  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    logger.error(`Failed to create wallet: ${error.message}`);
    throw error;
  }
};

// Check if wallet has sufficient balance
const checkWalletBalance = async (
  wallet,
  tokenContract,
  tokenDecimals,
  amount
) => {
  try {
    // Check ETH balance
    const ethBalance = await wallet.provider.getBalance(wallet.address);
    logger.info(
      `ETH balance for ${wallet.address}: ${ethers.formatEther(ethBalance)} ETH`
    );

    // Check token balance
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    logger.info(
      `Token balance for ${wallet.address}: ${ethers.formatUnits(
        tokenBalance,
        tokenDecimals
      )}`
    );

    return {
      hasEnoughEth: ethBalance >= ethers.parseEther("0.01"), // Minimum required ETH
      hasEnoughTokens: tokenBalance >= amount,
      ethBalance,
      tokenBalance,
    };
  } catch (error) {
    logger.error(`Failed to check wallet balance: ${error.message}`);
    throw error;
  }
};

module.exports = {
  getWallet,
  checkWalletBalance,
};

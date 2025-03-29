// utils/transactions.js
const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const logger = require("./logger");

// Create transactions directory if it doesn't exist
const txDir = path.join(process.cwd(), "transactions");
if (!fs.existsSync(txDir)) {
  fs.mkdirSync(txDir);
}

// Create CSV writer for transaction records
const getTransactionRecordWriter = (filename) => {
  return createObjectCsvWriter({
    path: path.join(txDir, filename),
    header: [
      { id: "timestamp", title: "TIMESTAMP" },
      { id: "txHash", title: "TX_HASH" },
      { id: "from", title: "FROM_ADDRESS" },
      { id: "to", title: "TO_ADDRESS" },
      { id: "token", title: "TOKEN" },
      { id: "amount", title: "AMOUNT" },
      { id: "sourceChain", title: "SOURCE_CHAIN" },
      { id: "destinationChain", title: "DESTINATION_CHAIN" },
      { id: "status", title: "STATUS" },
      { id: "blockNumber", title: "BLOCK_NUMBER" },
      { id: "gasUsed", title: "GAS_USED" },
      { id: "batchId", title: "BATCH_ID" },
    ],
    append: true,
  });
};

// Record a transaction
const recordTransaction = async (record) => {
  const writer = getTransactionRecordWriter("transactions.csv");
  try {
    await writer.writeRecords([
      {
        timestamp: new Date().toISOString(),
        ...record,
      },
    ]);
    logger.info(`Transaction recorded: ${record.txHash}`);
  } catch (error) {
    logger.error(`Failed to record transaction: ${error.message}`);
  }
};

// Wait between transactions to avoid rate limiting
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  recordTransaction,
  sleep,
};

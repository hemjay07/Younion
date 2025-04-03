// config/chains.js
module.exports = {
  // Source chain
  sepolia: {
    id: 11155111,
    name: "Sepolia",
    rpcUrl: "https://sepolia.drpc.org",
    contractAddress: "0x84F074C15513F15baeA0fbEd3ec42F0Bd1fb3efa",
    ethValue: "0.0080085",
  },

  // Destination chains
  babylon: {
    id: "bbn-test-5",
    name: "Babylon Testnet",
    sourceChannelId: 7, // Updated from 9 to 10 based on UI transaction
    prefix: "bbn",
  },

  union: {
    id: "union-testnet-9",
    name: "Union Testnet",
    sourceChannelId: 9,
    prefix: "union",
  },
};

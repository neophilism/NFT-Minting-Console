const base = require('../hardhat.config.cjs');
module.exports = {
  ...base,
  networks: { hardhat: { ...base.networks.hardhat, allowUnlimitedContractSize: false } },
  paths: { root: require('node:path').resolve(__dirname, '..'), sources: './test-safe/contracts', tests: './test-safe',
    cache: './cache-safe', artifacts: './artifacts-safe' },
};

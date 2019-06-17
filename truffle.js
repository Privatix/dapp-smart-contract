const Web3 = require("web3");
require("babel-polyfill");
require('babel-register')({
    // Ignore everything in node_modules except node_modules/zeppelin-solidity.
    presets: ["es2015"],
    plugins: ["syntax-async-functions", "transform-regenerator" /*, "truffle-security" */],
    ignore: /node_modules\/(?!openzeppelin-solidity)/,
});

const HDWalletProvider = require('truffle-hdwallet-provider');

const mnemonic = process.env.MNEMONIC;

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  plugins: [ "truffle-security" ],
  compilers: {
    solc: {
      version: "0.5.8"
    }
  },
  deploy: [
        "Sale"
    ],
    networks: {
        local: {
            host: 'localhost',
            port: 8545,
            network_id: '*',
        },
        local_geth: {
            host: 'localhost',
            port: 8545,
            network_id: '*'
        },
        rinkeby:  {
            provider: function() {
                return new HDWalletProvider(mnemonic, "https://rinkeby.infura.io/v3/bf0d30717bb8469aae7b3ea09d8f1dd9");
            },
            network_id: 4,
            gas: 6900000,
        },
        mainnet:  {
            provider: function() {
                return new HDWalletProvider(mnemonic, "https://mainnet.infura.io/v3/bf0d30717bb8469aae7b3ea09d8f1dd9");
            },
            network_id: '*',
            gas: 8000000,
        }
    },
    build: "webpack",
    mocha: {
        reporter: "xunit",
        reporterOptions: {
          output: "xunit.xml"
        }
    }
};

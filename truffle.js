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
//            network_id: 15
//            provider: new Web3.providers.WebsocketProvider('ws://127.0.0.1:8545'),
            network_id: '*'
        },
        ropsten:  {
            provider: function() {
                return new HDWalletProvider(mnemonic, "https://ropsten.infura.io/"+"MwLMPH2wFZ9sIIaQYniQ");
            },
            network_id: 3,
            gas: 4712388,
        },
        rinkeby:  {
            provider: function() {
                return new HDWalletProvider(mnemonic, "https://rinkeby.infura.io/v3/bf0d30717bb8469aae7b3ea09d8f1dd9");
            },
            network_id: 4,
            gas: 6900000,
        },
        coverage: {
            host: "localhost",
            network_id: "*",
            port: 8555,         // <-- If you change this, also set the port option in .solcover.js.   
            gas: 0xfffffffffff, // <-- Use this high gas value  
            gasPrice: 0x01      // <-- Use this low gas price 
        },
    },
    build: "webpack",
    mocha: {
        reporter: "xunit",
        reporterOptions: {
          output: "xunit.xml"
        }
    }
};

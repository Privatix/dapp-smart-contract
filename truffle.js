require("babel-polyfill");
require('babel-register')({
    // Ignore everything in node_modules except node_modules/zeppelin-solidity.
    presets: ["es2015"],
    plugins: ["syntax-async-functions","transform-regenerator"],
    ignore: /node_modules\/(?!openzeppelin-solidity)/,
});

const HDWalletProvider = require('truffle-hdwallet-provider')

const mnemonic = process.env.MNEMONIC ? process.env.MNEMONIC : "language core disease beach celery media mercy ready thing course modify fall lady bag carry";

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
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
            network_id: 15
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
                return new HDWalletProvider(mnemonic, "https://rinkeby.infura.io/"+"MwLMPH2wFZ9sIIaQYniQ");
            },
            network_id: 4,
            gas: 7000000,
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
        reporter: "xunit-file"
    }
};

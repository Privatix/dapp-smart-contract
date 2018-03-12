require("babel-polyfill");
require('babel-register')({
    // Ignore everything in node_modules except node_modules/zeppelin-solidity.
    presets: ["es2015"],
    plugins: ["syntax-async-functions","transform-regenerator"],
    ignore: /node_modules\/(?!zeppelin-solidity)/,
});

const HDWalletProvider = require('truffle-hdwallet-provider')

var mnemonic = "language core disease beach celery media mercy ready thing course modify fall lady bag carry";


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
            provider: new HDWalletProvider(mnemonic, "https://ropsten.infura.io/"+"MwLMPH2wFZ9sIIaQYniQ"),
            network_id: 3,
            gas: 4700000,
            // from: "0xA5020D791fb405BD2D516A2c0824e5bac0f764B8"
        },
        // testnet: {
        //     provider: provider,
        //      gasPrice: 200 * 10**8,
        //      gas: 3000000,
        //     network_id: 3 // official id of the ropsten network
        // },
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

const fs = require('fs');

const Ethereum = require('./ethereum.js');

const ABI_PATH = process.env.ABI_PATH;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const abi = JSON.parse(fs.readFileSync(ABI_PATH, {encoding: 'utf8'}));

const endpoint = "wss://rinkeby.infura.io/ws";
const ethereum = new Ethereum(abi, CONTRACT_ADDRESS, endpoint);

const web3 = ethereum.web3;

const props = [
'owner', 'popup_period', 'challenge_period', 'remove_period', 'network_fee', 'network_fee_address', 'channel_deposit_bugbounty_limit'
];
(async function getInfo(){
    const res = props.map(async function(prop){
        return ethereum.contract.methods[prop]().call();
    });
    const results = await Promise.all(res);
    props.forEach((prop, i) => console.log(`${prop}: ${results[i]}`));

    process.exit(0);
})();


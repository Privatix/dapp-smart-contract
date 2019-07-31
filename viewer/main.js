// USAGE CONTRACT_ADDRESS=0x0619ed1187ecad8d089269ce6c21ef12c8c0b72d NETWORK=mainnet ABI_PATH=../psc.abi node main.js
const fs = require('fs');

const Ethereum = require('./ethereum.js');

const ABI_PATH = process.env.ABI_PATH;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const NETWORK = process.env.NETWORK;

const abi = JSON.parse(fs.readFileSync(ABI_PATH, {encoding: 'utf8'}));

const endpoint = `wss://${NETWORK}.infura.io/ws/v3/bf0d30717bb8469aae7b3ea09d8f1dd9`;
const ethereum = new Ethereum(abi, CONTRACT_ADDRESS, endpoint);

const web3 = ethereum.web3;

const props = [
'popup_period' , 'challenge_period', 'remove_period', 'network_fee', 'network_fee_address', 'channel_deposit_bugbounty_limit'
];
(async function getInfo(){
    const res = props.map(async function(prop){
        return ethereum.contract.methods[prop]().call();
    });
    const results = await Promise.all(res);
    props.forEach((prop, i) => console.log(`${prop}: ${results[i]}`));
    if(props.includes('network_fee_address')){
        const index = props.indexOf('network_fee_address');
        const balance = await ethereum.contract.methods.balanceOf(results[index]).call();
        console.log('fee_address balance: ', balance.toString());
    }
    process.exit(0);
})();


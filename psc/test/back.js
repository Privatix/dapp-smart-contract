import fetch from 'node-fetch';
import increaseTime, { duration } from 'zeppelin-solidity/test/helpers/increaseTime';
// import moment from 'moment';
import * as chai from 'chai';
const config = require(`../targets/${process.env.TARGET}.json`);
const chaiAsPromised = require("chai-as-promised");

const express = require('express')

chai.use(chaiAsPromised);
const {expect, assert: chaiAssert } = chai;

const mcoloring = require('mocha').reporters.Base.color;

const mlog = {log: function(){
    console.log.apply(this, 
	    [].map.call(arguments, function(v, k) { return mcoloring('error stack', v); })
    );
}};

const abi = require('ethereumjs-abi');
const utils = require('ethereumjs-util');

const Prix_token = artifacts.require("../contracts/Token.sol");
// const Prix2_token = artifacts.require("../contracts/Token2.sol");
// const stdToken = artifacts.require("../contracts/StandardToken.sol");
const PSC = artifacts.require("../contracts/PrivatixServiceContract.sol");
const Sale = artifacts.require("../contracts/Sale.sol");

const gasUsage = {};
const challenge_period = config.challengePeriod;
console.log("challenge period: ", challenge_period);
let psc, sale, prix_token, owner;

const skip = async function(number){
    await prix_token.approve(psc.address, 1e8,{from:owner});
    for(var i = 0; i < number; i++) await psc.addBalanceERC20(10, {from:owner});
}

contract('PSC', (accounts) => {
    let wallet, client, vendor,  prix2_token, startTime, endTime;

    before(async () => {
        owner = web3.eth.accounts[0];
        wallet = web3.eth.accounts[1];
        client = web3.eth.accounts[2];
        vendor = web3.eth.accounts[5];
    });

    beforeEach(async function () {
        startTime = web3.eth.getBlock('latest').timestamp + duration.weeks(1);

        sale = await Sale.new(startTime, wallet);
        await sale.getFreeTokens(client,5e8);
        await sale.getFreeTokens(owner,5e8);
        await sale.getFreeTokens(vendor, 5e8);

        prix_token = await Prix_token.at(await sale.token());
        try {
            psc = await PSC.new(await sale.token(), owner, challenge_period+1)
        }catch(e){
            console.log("ERROR:", e);
        }
    });

    it("fake", async () => {
        assert.equal(1,1);
    });

});

const bodyParser = require('body-parser');
const multer = require('multer'); // v1.0.5
const upload = multer(); // for parsing multipart/form-data

const app = express();
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded


app.get('/getPSC' , (req, res) => res.json(psc));
app.get('/getSale', (req, res) => res.json(sale));
app.get('/getPrix', (req, res) => res.json(prix_token));

app.get('/getKeys', (req, res) => {
    // don't worry - node.js is smart enough to cache it )
    const fs = require('fs');
    const ganache_log = fs.readFileSync('./ganache.log', {encoding: "utf8"});
    // Available Accounts\n==================\n(0) 0xfae15efc293d4adf3e0ea7c1f33b5bc666a3cfe3\n(1) 0xd1b5190498fa09bf9317a898affda2c215e7e3c0\n(2) 0xa9a9e5df5f3cb7bf3905c12c5223b5f796f703f7\n(3)
    const allAccounts = /Available Accounts\n[=]+\n(\(\d+\)\s+0x[0-9a-f]+\n)+/i;
    const account = /0x[0-9a-f]{40}/gi;
    const accounts = ganache_log.match(allAccounts)[0].match(account);
    // Private Keys\n==================\n(0) dd3d4a91c97b95fe7c34f2db70193512b30cb52e8d845990c3d9b22fa6f1c035\n(1) c80c20830626027a567bd97041f913583b647babfc780494241e5ea18565e1b5\n(2)
    const allKeys = /Private Keys\n[=]+\n(\(\d+\)\s+[0-9a-f]+\n)+/i;
    const key = /[0-9a-f]{64}/gi;
    const keys = ganache_log.match(allKeys)[0].match(key);
    // const result = Object.keys(Array(keys.length)).map(i=>({account: accounts[i], privateKey: keys[i]}));
    const result = accounts.map((account, i) => ({account, privateKey: keys[i]}));

    res.json(result);

});

const quantities = ["result", "startingBlock", "currentBlock", "highestBlock", "gas", "gasPrice", "value", "nonce", "number", "difficulty", "totalDifficulty", "size", "gasLimit", "gasUsed", "timestamp", "blockNumber", "transactionIndex", "cumulativeGasUsed", "gasUsed", "status", "fromBlock", "toBlock", "logIndex", "priority", "ttl", "expiry", "sent", "workProved"];

const objectWalk = function(obj, hook) {
    for (let i in obj) {
        if(obj[i] instanceof Object && !(obj[i] instanceof String)){
            objectWalk(obj[i], hook);
        }
        if('string' === typeof obj[i] || obj[i] instanceof String){
            if(quantities.some(entry => entry === i)) {
                obj[i] = hook(obj[i]);
            }
        }
    }
};

app.post('/jsonrpc', upload.array(), async (req, res) => {
    if(req.body.method && (req.body.method in psc)){
        try{
            let result;
            if(typeof psc[req.body.method] === "function"){
                result = await psc[req.body.method](...req.body.params);
            }else{
                result = await psc[req.body.method];
            }
            objectWalk(result, str => {
                const res = str.replace(/^0x0+/, '0x');
                return res === '0x' ? '0x0' : res;
            });
            res.json({result, id: req.body.id, error: null});
        }catch(e){
            res.json({result: null, error: e, id: req.body.id});
        }
    }else{
       res.json({result: null, error: "unknown method", id: req.body.id});
    }
    // res.json(req);
});

app.get('/skip/:blocks', async (req, res) => {
    try{
        await skip(req.params.blocks);
        res.json({code: 200, message: `${req.params.blocks} blocks skipped`});
    }catch (e){
        res.json({code: 500, error: e});
    }
});

app.listen(config.port, () => console.log(`PSC API server is listening on port ${config.port}`));

const proxy = express();
proxy.use(bodyParser.json()); // for parsing application/json
proxy.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
};

proxy.post('/', upload.array(), async (req, res) => {
    // console.log(req);
    const body = Object.assign({}, req.body);
    fetch('http://127.0.0.1:8545/', {method: 'post', body: JSON.stringify(body), headers})
        .then(res => {
            const result = res.json();
            return result;
        })
        .then(json => {
            objectWalk(json, str => {
                const res = str.replace(/^0x0+/, '0x');
                return res === '0x' ? '0x0' : res;
            });
            res.json(json);
        });
});

proxy.listen(8546, () => console.log(`ganache proxy server is listening on port 8546`))

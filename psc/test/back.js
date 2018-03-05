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
let psc;

contract('PSC', (accounts) => {
    let owner, wallet, client, vendor, prix_token, prix2_token, startTime, endTime;
    let sale;

    before(async () => {
        owner = web3.eth.accounts[0];
        wallet = web3.eth.accounts[1];
        client = web3.eth.accounts[2];
        vendor = web3.eth.accounts[5];
    });

    beforeEach(async function () {
        startTime = web3.eth.getBlock('latest').timestamp + duration.weeks(1);

        sale = await Sale.new(startTime, wallet);
        console.log("Sale contract created");
        await sale.getFreeTokens(client,5e8);
        await sale.getFreeTokens(owner,5e8);
        await sale.getFreeTokens(vendor, 5e8);

        prix_token = await Prix_token.at(await sale.token());
        console.log("before PSC contract creating");
        try {
            psc = await PSC.new(await sale.token(), owner, challenge_period+1)
        }catch(e){
            console.log("ERROR:", e);
        }
        console.log("PSC contract created");

    });

    afterEach(function () {
        if(Object.keys(gasUsage).length){
            mlog.log("\tgas consumption:");
            for(var method in gasUsage){
                mlog.log("\t" + method + ": " + gasUsage[method]);
                delete gasUsage[method];
            }
        }
    });

    const skip = async function(number){
        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < number; i++) await psc.addBalanceERC20(10, {from:owner});
    }

    it("I0a: cooperativeClose, standard use case, 0% fee", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

    });

});


const app = express();
const owner = web3.eth.accounts[0];
const wallet = web3.eth.accounts[1];
const client = web3.eth.accounts[2];
const vendor = web3.eth.accounts[5];

app.get('/throwEventLogChannelCreated', (req, res) => {
    // res.send('Hello World!');
    const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
    const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
    console.log(psc);
    psc.throwEventLogChannelCreated(client, vendor, offering_hash, 500, authentication_hash)
       .then(result => {
            res.json(result);
       });
});
app.get('/getContract', (req, res) => {
    // res.send('Hello World!');
    res.json(psc);
});
app.listen(5000, () => console.log('Example app listening on port 5000!'))

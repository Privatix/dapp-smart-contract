import increaseTime, { duration } from 'openzeppelin-solidity/test/helpers/increaseTime';
// import moment from 'moment';
import * as chai from 'chai';
const config = require(`../targets/${process.env.TARGET}.json`);
const chaiAsPromised = require("chai-as-promised");

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
contract('PSC', (accounts) => {
    let owner, wallet, client, vendor, prix_token, prix2_token, psc, startTime, endTime;
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
        await sale.getFreeTokens(client,5e8);
        await sale.getFreeTokens(owner,5e8);
        await sale.getFreeTokens(vendor, 5e8);

        prix_token = await Prix_token.at(await sale.token());
        try {
            psc = await PSC.new(await sale.token(), owner, challenge_period)
        }catch(e){
            console.log("ERROR:", e);
        }
        // console.log("PSC contract created");

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
        let block = await prix_token.approve(psc.address, 1e8,{from:owner});
        let blockNum = block.receipt.blockNumber;
        const target = blockNum + number;
        while(blockNum < target){
            block = await psc.addBalanceERC20(10, {from:owner});
            blockNum = block.receipt.blockNumber;
        }
    }

    const getBalanceSignature = function(reciver, blockNumber, offering_hash, balance, contractAddress){

        const message_hash =
            abi.soliditySHA3(
                ['string','address','uint32', 'bytes32', 'uint192','address']
               ,[
                    'Privatix: sender balance proof signature',
                    reciver,
                    blockNumber,
                    offering_hash,
                    balance,
                    contractAddress
                ]
            ).toString('hex');

        return message_hash;
    }

    const getCloseSignature = function (sender, blockNumber, offering_hash, balance, contractAddress){
        const message_hash =
            abi.soliditySHA3(
                ['string','address','uint32', 'bytes32', 'uint192','address']
               ,[
                    'Privatix: receiver closing signature',
                    sender,
                    blockNumber,
                    offering_hash,
                    balance,
                    contractAddress
                ]
            ).toString('hex');

        return message_hash;
    }

    const eventChecker = function(_holder, eventName){
        // there are at least two ways to check event triggering - looking into transaction's result
        // or registering your own listener to watch events
        // I use both of them to show how to handle events
        // you can also register yours listeners via web3.eth.subscribe (not used here)

        return function(error, result){
            const holder = _holder;
            if (error){
                if(holder.handlers[eventName].reject(error));
            }else{
                holder.transaction.then(transaction => {
                    // not always, see E7 test
                    // assert.equal(result.transactionHash, transaction.receipt.transactionHash, "hashes must be equal");
                    expect(transaction.logs.some( log =>  log.event === eventName && result.event === eventName)).to.be.true;
                    holder.handlers[eventName].resolve();
                });
            }
        };
    };

    const putOnGuard = function(holder, events, contract){
        if(!("events" in holder)) holder.events = [];
        if(!("promises" in holder)) holder.promises = [];
        if(!("handlers" in holder)) holder.handlers = {};
        events.forEach(eventName => {
            const res = new Promise(function(resolve, reject){
                holder.handlers[eventName] = {resolve, reject};
                const event = contract[eventName]({fromBlock: 0, toBlock: 'latest'});
                event.watch(eventChecker(holder, eventName));
                holder.events.push(event);
            });
            holder.promises.push(res);
        });
    };


    it("I0a: cooperativeClose, standard use case, 0% fee", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        const sum = 10;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        const cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});
        gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        const ret = await psc.returnBalanceERC20(10, {from:vendor});
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+10, 'balance of vendor must be 5e8+20');
 
    });

    it("E1: createChannel/LogChannelCreated event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogChannelCreated"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        holder.transaction = psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("E4: registerServiseOffering/LogOfferingCreated event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogOfferingCreated"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        holder.transaction = psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("E7: cooperativeClose/LogCooperativeChannelClose&LogOfferingSupplyChanged events triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogCooperativeChannelClose"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);
        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        holder.transaction = psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));

    });

    it("I0b: cooperativeClose, standard use case, 0.57% fee", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');
        assert.equal((await prix_token.balanceOf(owner)).toNumber()/1e8, 5, 'balance of owner must be 5 prix');

        const fee = await psc.setNetworkFee(570, {from: owner});
        gasUsage["psc.setNetworkFee"] = fee.receipt.gasUsed;

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 200000, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 200000, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        const sum = 100000;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        const cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});
        gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        // approve - min_deposit*max_supplies + signed balance - fee
        assert.equal((await psc.internal_balances(vendor)).toNumber(), 1e8-2e6+100000-570, 'internal balance of vendor must be 4e8-2e6 + 100000-570 ');
        assert.equal((await psc.internal_balances(owner)).toNumber(), 570, 'internal balance of owner must be 570');

        const ret = await psc.returnBalanceERC20(100000-570, {from:vendor});
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        await psc.returnBalanceERC20(570, {from:owner});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+100000-570, 'balance of vendor must be 4e8+100000-570');
        assert.equal((await prix_token.balanceOf(owner)).toNumber(), 5e8+570, 'balance of owner must be 5e8+570');

    });

    it('I1a: cooperativeClose with wrong balance signature (client/client)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = web3.eth.sign(client, wrongBalanceSig);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = web3.eth.sign(client, wellBalanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1b: cooperativeClose with wrong balance signature (vendor/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = web3.eth.sign(vendor, wrongBalanceSig);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = web3.eth.sign(client, wellBalanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1c: cooperativeClose with wrong balance signature (client/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = web3.eth.sign(vendor, wrongBalanceSig);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = web3.eth.sign(client, wellBalanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1d: cooperativeClose with wrong close signature (client/client)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(client, closeSig);
        const wellSignedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it('I1e: cooperativeClose with wrong close signature (vendor/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongCloseSig = getCloseSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(vendor, wrongCloseSig);
        const wellSignedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it('I1f: cooperativeClose with wrong close signature (vendor/client)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongCloseSig = getCloseSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(client, wrongCloseSig);
        const wellSignedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it('I2: uncooperative closing channel', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        const sum = 10;
        const uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;

        await skip(challenge_period);
        const settle = await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.settle"] = settle.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        const ret = await psc.returnBalanceERC20(20, {from:vendor});
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of vendor must be 4e8+20');
 
    });

    it('I4: settle, balances checking', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        await psc.setNetworkFee(500, {from: owner})

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 300000, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        const sum = 200000;
        const uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;

        await skip(challenge_period);
        gasUsage['ownerBefore'] = (await psc.internal_balances(owner)).toNumber();
        gasUsage['vendorBefore'] = (await psc.internal_balances(vendor)).toNumber();
        gasUsage['clientBefore'] = (await psc.internal_balances(client)).toNumber();

        const settle = await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.settle"] = settle.receipt.gasUsed;

        gasUsage['ownerAfter'] = (await psc.internal_balances(owner)).toNumber();
        gasUsage['vendorAfter'] = (await psc.internal_balances(vendor)).toNumber();
        gasUsage['clientAfter'] = (await psc.internal_balances(client)).toNumber();

        const fee = gasUsage['ownerAfter'] - gasUsage['ownerBefore'];
        const vendorBonus = gasUsage['vendorAfter'] - gasUsage['vendorBefore'];
        const clientRest = gasUsage['clientAfter'] - gasUsage['clientBefore'];

        assert.equal(fee, 1000, 'fee must be 1000');
        assert.equal(vendorBonus, 200000 - 1000, 'vendor bonus must be 199000');
        assert.equal(clientRest, 100000, 'rest of client must be 100000');

    });

    it('E3: uncooperativeClose/LogChannelCloseRequested event triggering', async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogChannelCloseRequested"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        holder.transaction = psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it('E9: settle/LogUnCooperativeChannelClose event triggering', async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogUnCooperativeChannelClose"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        const uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});

        await skip(challenge_period);
        holder.transaction = psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("I3: measuring gas consumption for other members:", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const topUp = await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});
        gasUsage["psc.topUp"] = topUp.receipt.gasUsed;

        const channelInfo = await psc.getChannelInfo(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.getChannelInfo"] = await psc.getChannelInfo.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        const publishServiceOfferingEndpoint = await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});
        gasUsage["psc.publishServiceOfferingEndpoint"] =  await psc.publishServiceOfferingEndpoint.estimateGas(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        const sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        const cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        const ret = await psc.returnBalanceERC20(20, {from:vendor});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of vendor must be 4e8+20');

        gasUsage["psc.extractSignature (balance)"] = await psc.extractSignature.estimateGas(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, true, {from:vendor});
        gasUsage["psc.extractSignature (closing)"] = await psc.extractSignature.estimateGas(client, channel.receipt.blockNumber, offering_hash, sum, signedCloseSig, false, {from:client});
        gasUsage["psc.getKey"] = await psc.getKey.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.balanceOf"] = await psc.balanceOf.estimateGas(client, {from:client});

        await skip(challenge_period);
        gasUsage["psc.popupServiceOffering"] = await psc.popupServiceOffering.estimateGas(offering_hash, {from:vendor});
        await psc.popupServiceOffering(offering_hash, {from:vendor});

        await skip(challenge_period);
        gasUsage["psc.removeServiceOffering"] = await psc.removeServiceOffering.estimateGas(offering_hash, {from:vendor});
 
    });

    it("E2: topUpChannel/LogChannelToppedUp event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogChannelToppedUp"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        holder.transaction = psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("E5: removeServiceOffering/LogOfferingDeleted event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogOfferingDeleted"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await skip(challenge_period);
        holder.transaction = psc.removeServiceOffering(offering_hash, {from:vendor});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("E6: publishServiceOfferingEndpoint/LogOfferingEndpoint event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogOfferingEndpoint"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});
        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        holder.transaction =  psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("E8: popupServiceOffering/LogOfferingPopedUp event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        putOnGuard(holder, ["LogOfferingPopedUp"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        await skip(challenge_period);
        holder.transaction = psc.popupServiceOffering(offering_hash, {from:vendor});

        return Promise.all(holder.promises).then(() => holder.events.forEach(event => event.stopWatching()));
    });

    it("S1: check if provider try to publish offering with overflow in _min_deposit * _max_supply", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        // (2^191+1)*2 mod(2^192) == 2
        const min_deposit = web3.toBigNumber('0x800000000000000000000000000000000000000000000001');
        chaiAssert.isRejected(psc.registerServiceOffering(offering_hash, min_deposit, 2, {from:vendor}));
        chaiAssert.isFulfilled(psc.registerServiceOffering(offering_hash, 2, 2, {from:vendor}));
 
    });

    it("S2: check if provider try to publish offering twice", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        chaiAssert.isFulfilled(psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor}));
        await skip(1);
        chaiAssert.isRejected(psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor}));
 
    });

    it("S3: check if provider try to publish offering with zero min_deposit", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await skip(1);
        chaiAssert.isRejected(psc.registerServiceOffering(offering_hash, 0, 2, {from:vendor}));
        await skip(1);
        chaiAssert.isFulfilled(psc.registerServiceOffering(offering_hash, 1, 2, {from:vendor}));
 
    });

    it("S4: check if client try to create channel with insufficient deposit value", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        chaiAssert.isRejected(psc.createChannel(vendor, offering_hash, 19, authentication_hash, {from:client}));
        chaiAssert.isFulfilled(psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client}));

    });

    it("S5: check if client try to create channel with insufficient internal balance", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(20, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        chaiAssert.isRejected(psc.createChannel(vendor, offering_hash, 21, authentication_hash, {from:client}));
        chaiAssert.isFulfilled(psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client}));

    });

    it("S6: check if try to close channel without signing the agent", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(client, closeSig);
        const wellSignedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it("S7: check if try to .settle() channel without unCooperativeClose call", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;

        await skip(challenge_period);
        chaiAssert.isRejected(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
 
        await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        await skip(challenge_period);
        chaiAssert.isFulfilled(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
    });

    it("S8: check if try to .settle() channel before the expiry of the challenge_period", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});

        await skip(challenge_period-3);
        chaiAssert.isRejected(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));

        await skip(3);
        chaiAssert.isFulfilled(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
 
    });

    it('S9: uncooperative close, trying to close nonexistent channel', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;

        chaiAssert.isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, nonexistent_offering_hash, sum, {from: client}));
        chaiAssert.isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));

    });

    it('S10: uncooperative close, try to close channel twice', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;
        await skip(1);
        chaiAssert.isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));
        await skip(1);
        chaiAssert.isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));
 
    });

    it('S11: uncooperative close, try to close with insufficient internal balance', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 1e8, authentication_hash, {from:client});

        await skip(1)
        chaiAssert.isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, 1e8+1, {from: client}));
        await skip(1)
        chaiAssert.isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, 1e8, {from: client}));
    });

    it("S12: try to publish endpoint from someone else's name", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        chaiAssert.isRejected(psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:owner}));
        chaiAssert.isFulfilled(psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor}));

    });

    it("S13: try to remove nonexistent offering", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');

        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        await skip(challenge_period);
        chaiAssert.isRejected(psc.removeServiceOffering(nonexistent_offering_hash, {from:vendor}));
        chaiAssert.isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S14: try to remove offering from someone else's name", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        await skip(challenge_period);
        chaiAssert.isRejected(psc.removeServiceOffering(offering_hash, {from:client}));
        await skip(1)
        chaiAssert.isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S15: try to remove offering before the expiry of the challenge_period", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        chaiAssert.isRejected(psc.removeServiceOffering(offering_hash, {from:vendor}));
        await skip(challenge_period);
        chaiAssert.isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S16: try to popup nonexistent offering", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');

        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await skip(challenge_period);

        chaiAssert.isRejected(psc.popupServiceOffering(nonexistent_offering_hash, {from:vendor}));
        await skip(1);
        chaiAssert.isFulfilled(psc.popupServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S16a: try to popup offering before challenge period ends", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');

        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        await skip(challenge_period);
        chaiAssert.isFulfilled(psc.popupServiceOffering(offering_hash, {from:vendor}));
        await skip(1);
        chaiAssert.isRejected(psc.popupServiceOffering(offering_hash, {from:vendor}));

        await skip(challenge_period);
        chaiAssert.isFulfilled(psc.popupServiceOffering(offering_hash, {from:vendor}));
    });

    it("S17: try to popup from someone else's name", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await skip(challenge_period);
        chaiAssert.isRejected(psc.popupServiceOffering(offering_hash, {from:client})); // actually must be from:vendor
        chaiAssert.isFulfilled(psc.popupServiceOffering(offering_hash, {from:vendor})); // should be ok 
    });

    it('S18: trying to send money directly to contract (should throw exception)', async () => {

        const balanceBefore = await web3.eth.getBalance(psc.address);
        expect(() => web3.eth.sendTransaction({from: owner, to: psc.address, value: 1000})).to.throw();
        const balanceAfter = await web3.eth.getBalance(psc.address);

        assert.equal(balanceBefore.eq(balanceAfter), true, 'balance must not be changed');
    });

    it('S19: cooperativeClose, too big balance amount in balanceSignature', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 200;
        const wrongBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = web3.eth.sign(client, wrongBalanceSig);

        const wrongCloseSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(vendor, wrongCloseSig);

        const okSum = 20;
        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, okSum, psc.address);
        const wellSignedBalanceSig = web3.eth.sign(client, wellBalanceSig);

        const wellCloseSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, okSum, psc.address);
        const wellSignedCloseSig = web3.eth.sign(vendor, wellCloseSig);

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, okSum, wellSignedBalanceSig, wellSignedCloseSig, {from: vendor})
        );
    });

    it('S20: cooperative close, check if try to close channel twice', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = web3.eth.sign(client, balanceSig);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = web3.eth.sign(vendor, closeSig);

        chaiAssert.isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor})
        );

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        await psc.returnBalanceERC20(20, {from:vendor});
        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of vendor must be 4e8+20');

        chaiAssert.isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor})
        );
 
    });

    it("S21: try to return balance from another's account", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        chaiAssert.isRejected( psc.returnBalanceERC20(1, {from:vendor}) );

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 5e8, 'balance of vendor must be 5 prix');

    });

    it("S22: check if stranger try to set fee", async () => {

        chaiAssert.isRejected(psc.setNetworkFee(5, {from: vendor}));

    });

    it("S23: check if fee is more than 1% (1000)", async () => {

        chaiAssert.isRejected(psc.setNetworkFee(1001, {from: owner}));

    });

    it("S24: check if stranger try to set fee address", async () => {

        chaiAssert.isRejected(psc.setNetworkFeeAddress(vendor, {from: vendor}));

    });

    it("S25: check constructor name", async () => {

        assert.equal("function" == typeof psc.PrivatixServiceContract, false, "constructor name not match with contract name which make it like regular function");

    });


    it("S26: check vendor balance before creating offering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        chaiAssert.isRejected(psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor}));

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});
        chaiAssert.isFulfilled(psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor}));

    });

    it("U1: psc.balanceOf", async () => {

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});
        const balance = await psc.balanceOf.call(client, {from:client});
        assert.equal(balance, 1e8, 'balance must be 1 prix');
    });

    it("U2: psc.getOfferingSupply", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});

        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        const channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        const supply = await psc.getOfferingSupply(offering_hash);

        assert.equal(supply.toNumber(), 9, 'expected 9 free offering supplies');

    });

});

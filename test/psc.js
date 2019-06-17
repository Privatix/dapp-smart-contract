// import * as chai from 'chai';
const config = require(`../targets/${process.env.TARGET}.json`);
// const chaiAsPromised = require("chai-as-promised");

// chai.use(chaiAsPromised);
// const {expect, assert: chaiAssert } = chai;

// const mcoloring = require('mocha').reporters.Base.color;
/*
const mlog = {log: function(){
    console.log.apply(this, 
	    [].map.call(arguments, function(v, k) { return mcoloring('error stack', v); })
    );
}};
*/
const abi = require('ethereumjs-abi');

const Prix_token = artifacts.require("../contracts/Token.sol");
const PSC = artifacts.require("../contracts/PrivatixServiceContract.sol");
const Sale = artifacts.require("../contracts/Sale.sol");

const gasUsage = {};
const {remove_period, popup_period, challenge_period} = config;
console.log("challenge period: ", challenge_period);
console.log("remove period: ", remove_period);
console.log("popup period: ", popup_period);


const isRejected  = promise => promise.then( (res => assert.equal(true, false)), (err => assert.equal(true, true)) );
const isFulfilled = promise => promise.then( (res => assert.equal(true, true)), (err => assert.equal(true, false)) );

contract('PSC', (accounts) => {
    let owner, wallet, client, vendor, prix_token, prix2_token, psc, startTime, endTime;
    let sale;

    before(async () => {
        owner = accounts[0];
        wallet = accounts[1];
        client = accounts[2];
        vendor = accounts[5];
    });

    beforeEach(async function () {
        startTime = (await web3.eth.getBlock('latest')).timestamp + 7*24*60*60;

        sale = await Sale.new(startTime, wallet);

        await sale.getFreeTokens(client,5e8);
        await sale.getFreeTokens(owner,5e8);
        await sale.getFreeTokens(vendor, 5e8);

        prix_token = await Prix_token.at(await sale.token());
        try {
            psc = await PSC.new(await sale.token(), owner, popup_period, remove_period, challenge_period)
        }catch(e){
            console.log("ERROR:", e);
        }

    });

    afterEach(function () {
        /*
        if(Object.keys(gasUsage).length){
            mlog.log("\tgas consumption:");
            for(var method in gasUsage){
                mlog.log("\t" + method + ": " + gasUsage[method]);
                delete gasUsage[method];
            }
        }
       */
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
            web3.utils.soliditySha3(
               { t: 'string',v: 'Privatix: sender balance proof signature' }
              ,{ t: 'address', v: reciver }
              ,{ t: 'uint32', v: blockNumber }
              ,{ t: 'bytes32', v: offering_hash}
              ,{ t: 'uint64', v: balance}
              ,{ t: 'address', v: contractAddress}
            ).toString('hex');

        return message_hash;
    }

    const getCloseSignature = function (sender, blockNumber, offering_hash, balance, contractAddress){
        const message_hash =
            web3.utils.soliditySha3(
               { t: 'string',v: 'Privatix: receiver closing signature' }
              ,{ t: 'address', v: sender }
              ,{ t: 'uint32', v: blockNumber }
              ,{ t: 'bytes32', v: offering_hash}
              ,{ t: 'uint64', v: balance}
              ,{ t: 'address', v: contractAddress}
            ).toString('hex');

        return message_hash;
    }


    const consistOf = function(obj, keys){
        const eventKeys = Object.keys(obj);
        return keys.every(key => eventKeys.includes(key));
    };

    const isWellFormedEvent = function(eventName, event){
        if(eventName !== event.event){
            return false;
        }
        switch(eventName){
            case 'LogChannelCreated':
                return consistOf(event.args, ['_agent', '_client', '_offering_hash', '_deposit']);
            case 'LogChannelToppedUp':
                return consistOf(event.args, ['_agent', '_client', '_offering_hash', '_open_block_number', '_added_deposit']);
            case 'LogChannelCloseRequested':
                return consistOf(event.args, ['_agent', '_client', '_offering_hash', '_open_block_number', '_balance']);
            case 'LogOfferingCreated':
                return consistOf(event.args, ['_agent', '_offering_hash', '_min_deposit', '_current_supply', '_source_type', '_source']);
            case 'LogOfferingDeleted':
                return consistOf(event.args, ['_agent', '_offering_hash']);
            case 'LogOfferingPopedUp':
                return consistOf(event.args, ['_agent', '_offering_hash', '_min_deposit', '_current_supply', '_source_type', '_source']);
            case 'LogCooperativeChannelClose':
                return consistOf(event.args, ['_agent', '_client', '_offering_hash', '_open_block_number', '_balance']);
            case 'LogUnCooperativeChannelClose':
                return consistOf(event.args, ['_agent', '_client', '_offering_hash', '_open_block_number', '_balance']);
            default:
                return false;
        }
    }

    const putOnGuard = async function(events, contract){
        const blockNumber = await web3.eth.getBlockNumber();
        return async function(){
            const allPromises = events.map(eventName => {
                return new Promise(async function(resolve, reject){
                    const events = await contract.getPastEvents(eventName, {fromBlock: blockNumber, toBlock: 'latest'});
                    if(events.length && events.every(event => isWellFormedEvent(eventName, event))){
                        resolve(true);
                    }else{
                        reject();
                    }
                });
            });
            return (await Promise.all(allPromises)).every(res => res);
        };
    };

    it("I0a: cooperativeClose, standard use case, 0% fee", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering_hash = "0x" + abi.soliditySHA3(['string'],[msg + '?']).toString('hex');
        const registerService= await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        gasUsage['registerServiceOffering'] = registerService.receipt.gasUsed;

    });

    it("E1: createChannel/LogChannelCreated event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const holder = {};
        const check = await putOnGuard(["LogChannelCreated"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        await psc.createChannel(vendor, offering_hash, 20, {from:client});

        assert.equal((await check()), true);

    });

    it("E4: registerServiseOffering/LogOfferingCreated event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const check = await putOnGuard(["LogOfferingCreated"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        assert.equal((await check()), true);
    });

    it("E7: cooperativeClose/LogCooperativeChannelClose&LogOfferingSupplyChanged events triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogCooperativeChannelClose"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});
        const sum = 10;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);
        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        const close = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});

        assert.equal((await checkEvents()), true);

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
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 200000, 10, 1, msg, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const channel = await psc.createChannel(vendor, offering_hash, 200000, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        const sum = 100000;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

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
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = await web3.eth.sign(wrongBalanceSig, client);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = await web3.eth.sign(wellBalanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );

        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1b: cooperativeClose with wrong balance signature (vendor/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = await web3.eth.sign(wrongBalanceSig, vendor);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = await web3.eth.sign(wellBalanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1c: cooperativeClose with wrong balance signature (client/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const wrongBalanceSig = getBalanceSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = await web3.eth.sign(wrongBalanceSig, vendor);

        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wellSignedBalanceSig = await web3.eth.sign(wellBalanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, signedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wellSignedBalanceSig, signedCloseSig, {from: vendor})
        );

    });

    it('I1d: cooperativeClose with wrong close signature (client/client)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = await web3.eth.sign(closeSig, client);
        const wellSignedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it('I1e: cooperativeClose with wrong close signature (vendor/vendor)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongCloseSig = getCloseSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = await web3.eth.sign(wrongCloseSig, vendor);
        const wellSignedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it('I1f: cooperativeClose with wrong close signature (vendor/client)', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        var sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongCloseSig = getCloseSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = await web3.eth.sign(wrongCloseSig, client);
        const wellSignedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        await isFulfilled(
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
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});
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
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        const channel = await psc.createChannel(vendor, offering_hash, 300000, {from:client});
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

    it("I5: increase offering suppply", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 1, 1, msg, {from:vendor});
        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});
        // try again
        await isRejected(psc.createChannel(vendor, offering_hash, 20, {from:client}));

    });

    it('E3: uncooperativeClose/LogChannelCloseRequested event triggering', async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogChannelCloseRequested"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});
        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;
        await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        await checkEvents();
    });

    it('E9: settle/LogUnCooperativeChannelClose event triggering', async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogUnCooperativeChannelClose"], psc);

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;
        const uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});

        await skip(challenge_period);
        await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        await checkEvents();
    });

    it("I3: measuring gas consumption for other members:", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const topUp = await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});
        gasUsage["psc.topUp"] = topUp.receipt.gasUsed;

        const channelInfo = await psc.getChannelInfo(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.getChannelInfo"] = await psc.getChannelInfo.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        const sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        const cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        const ret = await psc.returnBalanceERC20(20, {from:vendor});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of vendor must be 4e8+20');

        gasUsage["psc.extractSignature (balance)"] = await psc.extractSignature.estimateGas(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, true, {from:vendor});
        gasUsage["psc.extractSignature (closing)"] = await psc.extractSignature.estimateGas(client, channel.receipt.blockNumber, offering_hash, sum, signedCloseSig, false, {from:client});
        gasUsage["psc.getKey"] = await psc.getKey.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.balanceOf"] = await psc.balanceOf.estimateGas(client, {from:client});

        await skip(popup_period);
        // gasUsage["psc.popupServiceOffering"] = await psc.popupServiceOffering.estimateGas(offering_hash, 1, msg, {from:vendor});
        const popupService = await psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor});
        gasUsage["psc.popupServiceOffering"] = popupService.receipt.gasUsed;

        await skip(remove_period);
        gasUsage["psc.removeServiceOffering"] = await psc.removeServiceOffering.estimateGas(offering_hash, {from:vendor});
 
    });

    it("E2: topUpChannel/LogChannelToppedUp event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogChannelToppedUp"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});
        await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});

        await checkEvents();
    });

    it("E5: removeServiceOffering/LogOfferingDeleted event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogOfferingDeleted"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await skip(remove_period);
        await psc.removeServiceOffering(offering_hash, {from:vendor});

        await checkEvents();
    });

    it("E8: popupServiceOffering/LogOfferingPopedUp event triggering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const checkEvents = await putOnGuard(["LogOfferingPopedUp"], psc);

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        await skip(popup_period);
        await psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor});

        await checkEvents();
    });

    it("S1: check if provider try to publish offering with overflow in _min_deposit * _max_supply", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        // (2^63+1)*2 mod(2^64) == 2
        const min_deposit = new web3.utils.BN('0x8000000000000001');
        await isRejected(psc.registerServiceOffering(offering_hash, min_deposit, 2, 1, msg, {from:vendor}));
        await isFulfilled(psc.registerServiceOffering(offering_hash, 2, 2, 1, msg, {from:vendor}));
 
    });

    it("S2: check if provider try to publish offering twice", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await isFulfilled(psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor}));
        await skip(1);
        await isRejected(psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor}));
 
    });

    it("S3: check if provider try to publish offering with zero min_deposit", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await skip(1);
        await isRejected(psc.registerServiceOffering(offering_hash, 0, 2, 1, msg, {from:vendor}));
        await skip(1);
        await isFulfilled(psc.registerServiceOffering(offering_hash, 1, 2, 1, msg, {from:vendor}));
 
    });

    it("S4: check if client try to create channel with insufficient deposit value", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        await isRejected(psc.createChannel(vendor, offering_hash, 19, {from:client}));
        await isFulfilled(psc.createChannel(vendor, offering_hash, 20, {from:client}));

    });

    it("S5: check if client try to create channel with insufficient internal balance", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(20, {from:client});

        await isRejected(psc.createChannel(vendor, offering_hash, 21, {from:client}));
        await isFulfilled(psc.createChannel(vendor, offering_hash, 20, {from:client}));

    });

    it("S6: check if try to close channel without signing the agent", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;
        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = web3.eth.sign(closeSig, client);
        const wellSignedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, wellSignedCloseSig, {from: vendor})
        );

    });

    it("S7: check if try to .settle() channel without unCooperativeClose call", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;

        await skip(challenge_period);
        await isRejected(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
 
        await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        await skip(challenge_period);
        await isFulfilled(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
    });

    it("S8: check if try to .settle() channel before the expiry of the remove_period", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;
        await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});

        await skip(challenge_period-3);
        await isRejected(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));

        await skip(3);
        await isFulfilled(psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client}));
 
    });

    it('S9: uncooperative close, trying to close nonexistent channel', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;

        await isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, nonexistent_offering_hash, sum, {from: client}));
        await isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));

    });

    it('S10: uncooperative close, try to close channel twice', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;
        await skip(1);
        await isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));
        await skip(1);
        await isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client}));
 
    });

    it('S11: uncooperative close, try to close with insufficient internal balance', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 1e8, {from:client});

        await skip(1)
        await isRejected(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, 1e8+1, {from: client}));
        await skip(1)
        await isFulfilled(psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, 1e8, {from: client}));
    });

    it("S13: try to remove nonexistent offering", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');

        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        await skip(remove_period);
        await isRejected(psc.removeServiceOffering(nonexistent_offering_hash, {from:vendor}));
        await isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S14: try to remove offering from someone else's name", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        await skip(remove_period);
        await isRejected(psc.removeServiceOffering(offering_hash, {from:client}));
        await skip(1)
        await isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S15: try to remove offering before the expiry of the remove_period", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await isRejected(psc.removeServiceOffering(offering_hash, {from:vendor}));
        await skip(remove_period);
        await isFulfilled(psc.removeServiceOffering(offering_hash, {from:vendor}));
 
    });

    it("S16: try to popup nonexistent offering", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const nonexistent_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');

        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await skip(popup_period);

        await isRejected(psc.popupServiceOffering(nonexistent_offering_hash, 1, msg, {from:vendor}));
        await skip(1);
        await isFulfilled(psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor}));
 
    });

    it("S16a: try to popup offering before popup period ends", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});
        await skip(popup_period);
        await isFulfilled(psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor}));
        await skip(1);
        await isRejected(psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor}));

        await skip(popup_period);
        await isFulfilled(psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor}));
    });

    it("S17: try to popup from someone else's name", async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await skip(popup_period);
        await isRejected(psc.popupServiceOffering(offering_hash, 1, msg, {from:client})); // actually must be from:vendor
        await isFulfilled(psc.popupServiceOffering(offering_hash, 1, msg, {from:vendor})); // should be ok
    });

    it('S18: trying to send money directly to contract (should throw exception)', async () => {

        const balanceBefore = await web3.eth.getBalance(psc.address);
        await isRejected(
            web3.eth.sendTransaction({from: owner, to: psc.address, value: 1000})
        )
        const balanceAfter = await web3.eth.getBalance(psc.address);

        assert.equal(balanceBefore, balanceAfter, 'balance must not be changed');
    });

    it('S19: cooperativeClose, too big balance amount in balanceSignature', async () => {

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 200;
        const wrongBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedBalanceSig = await web3.eth.sign(wrongBalanceSig, client);

        const wrongCloseSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const wrongSignedCloseSig = await web3.eth.sign(wrongCloseSig, vendor);

        const okSum = 20;
        const wellBalanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, okSum, psc.address);
        const wellSignedBalanceSig = await web3.eth.sign(wellBalanceSig, client);

        const wellCloseSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, okSum, psc.address);
        const wellSignedCloseSig = await web3.eth.sign(wellCloseSig, vendor);

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, wrongSignedBalanceSig, wrongSignedCloseSig, {from: vendor})
        );
        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, okSum, wellSignedBalanceSig, wellSignedCloseSig, {from: vendor})
        );
    });

    it('S20: cooperative close, check if try to close channel twice', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const sum = 10;

        const balanceSig = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedBalanceSig = await web3.eth.sign(balanceSig, client);

        const closeSig = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        const signedCloseSig = await web3.eth.sign(closeSig, vendor);

        await isFulfilled(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor})
        );

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        await psc.returnBalanceERC20(20, {from:vendor});
        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of vendor must be 4e8+20');

        await isRejected(
            psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, signedBalanceSig, signedCloseSig, {from: vendor})
        );
 
    });

    it("S21: try to return balance from another's account", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        await isRejected( psc.returnBalanceERC20(1, {from:vendor}) );

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 5e8, 'balance of vendor must be 5 prix');

    });

    it("S22: check if stranger try to set fee", async () => {

        await isRejected(psc.setNetworkFee(5, {from: vendor}));

    });

    it("S23: check if fee is more than 1% (1000)", async () => {

        await isRejected(psc.setNetworkFee(1001, {from: owner}));

    });

    it("S24: check if stranger try to set fee address", async () => {

        await isRejected(psc.setNetworkFeeAddress(vendor, {from: vendor}));

    });

    it("S25: check constructor name", async () => {

        assert.equal("function" == typeof psc.PrivatixServiceContract, false, "constructor name not match with contract name which make it like regular function");

    });


    it("S26: check vendor balance before creating offering", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        await isRejected(psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor}));

        await prix_token.approve(psc.address, 1e8,{from:vendor});
        await psc.addBalanceERC20(1e8, {from:vendor});
        await isFulfilled(psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor}));

    });

    it("U1: psc.balanceOf", async () => {

        await prix_token.approve(psc.address, 1e8,{from:client});
        await psc.addBalanceERC20(1e8, {from:client});
        const balance = await psc.balanceOf.call(client, {from:client});
        assert.equal(balance, 1e8, 'balance must be 1 prix');
    });

    it("U2: psc.getOfferingInfo", async () => {

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'balance of vendor must be 5 prix');

        const approve = await prix_token.approve(psc.address, 1e8,{from:vendor});

        const block = await psc.addBalanceERC20(1e8, {from:vendor});

        const offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        const msg = 'plyzfy3qicjjvmeg.onion';
        const offering = await psc.registerServiceOffering(offering_hash, 20, 10, 1, msg, {from:vendor});

        const ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});

        const ClientBlock = await psc.addBalanceERC20(1e8, {from:client});

        const channel = await psc.createChannel(vendor, offering_hash, 20, {from:client});

        const retrievedOffering = await psc.getOfferingInfo(offering_hash);
        assert.equal(retrievedOffering[3].toNumber(), 9, 'expected 9 free offering supplies');

    });

});

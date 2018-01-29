import increaseTime, { duration } from 'zeppelin-solidity/test/helpers/increaseTime';
import moment from 'moment';

var mcoloring = require('mocha').reporters.Base.color;

const mlog = {log: function(){
    console.log.apply(this, 
	    [].map.call(arguments, function(v, k) { return mcoloring('error stack', v); })
    );
}};

var abi = require('ethereumjs-abi');
const utils = require('ethereumjs-util');

var Prix_token = artifacts.require("../contracts/Token.sol");
var Prix2_token = artifacts.require("../contracts/Token2.sol");
var PSC = artifacts.require("../contracts/PrivatixServiceContract.sol");
var Sale = artifacts.require("../contracts/Sale.sol");

var gasUsage = {};
const challenge_period = 510;

contract('PSC', (accounts) => {
    let owner, wallet, client, client1, client_wl, vendor, prix_token, prix2_token, psc, startTime, endTime;
    let testMaxTokens, testMaxEthers, testMinEthers, testRate, sale;

    before(async () => {
        owner = web3.eth.accounts[0];
        wallet = web3.eth.accounts[1];
        client = web3.eth.accounts[2];
        client1 = web3.eth.accounts[3];
        client_wl = web3.eth.accounts[4];
        vendor = web3.eth.accounts[5];
    });

    beforeEach(async function () {
        startTime = web3.eth.getBlock('latest').timestamp + duration.weeks(1);

        sale = await Sale.new(startTime, wallet);

        await sale.getFreeTokens(client,5e8);
        await sale.getFreeTokens(owner,5e8);
        await sale.getFreeTokens(client_wl,5e8);
        await sale.getFreeTokens(vendor, 5e8);

        prix_token = await Prix_token.at(await sale.token());

        psc = await PSC.new(await sale.token(), challenge_period);

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

    let shouldHaveException = async (fn, error_msg) => {
        let has_error = false;

        try {
            await fn();
        } catch(err) {
            has_error = true;
        } finally {
            assert.equal(has_error, true, error_msg);
        }

    }


    let getBalanceSignature = function(reciver, blockNumber, offering_hash, balance, contractAddress){

        var message_hash = abi.soliditySHA3(['bytes32','bytes32'],
            [abi.soliditySHA3(['string', 'string','string','string','string','string'],['string message_id',
                'address receiver',
                'uint32 block_created',
                'bytes32 offering_hash',
                'uint192 balance',
                'address contract']),
                abi.soliditySHA3(['string','address','uint32', 'bytes32', 'uint192','address'],[
                    'Sender balance proof signature',
                    reciver,
                    blockNumber,
                    offering_hash,
                    balance,
                    contractAddress]
                )]
        ).toString('hex');

        return message_hash;
    }

    let getCloseSignature = function (sender, blockNumber, offering_hash, balance, contractAddress){
        var message_hash = abi.soliditySHA3(['bytes32','bytes32'],
            [abi.soliditySHA3(['string','string', 'string','string','string','string'],
                ['string message_id',
                'address sender',
                'uint32 block_created',
                'bytes32 offering_hash',
                'uint192 balance',
                'address contract']),
                abi.soliditySHA3(['string','address','uint32', 'bytes32', 'uint192','address'],[
                    'Receiver closing signature',
                    sender,
                    blockNumber,
                    offering_hash,
                    balance,
                    contractAddress]
                )]
        ).toString('hex');
        return message_hash;
    }


    it("Will be opening deposit and full has closed deposit cooperative", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        console.log((await psc.getBalanceInfo({from: vendor})).toString(10));
        var ret = await psc.returnBalanceERC20(10, {from:vendor});
        console.log((await psc.getBalanceInfo({from: vendor})).toString(10));
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+10, 'balance of sender must be 5e8+20');
 
    });

    it("S1: check if provider try to publish offering with overflow in _min_deposit * _max_supply", async () => {
        // console.log(web3);
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        // (2^255+1)*2 mod(2^256) == 2
        const min_deposit = web3.toBigNumber('0x8000000000000000000000000000000000000000000000000000000000000001');
        await shouldHaveException(async () => {
            await psc.registerServiceOffering(offering_hash, min_deposit, 2, {from:vendor});
        }, "Should has an error");
 
    });

    it("S2: check if provider try to publish offering twice", async () => {
        // console.log(web3);
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        // (1e255+1)*2 mod(1e256) == 2
        // const min_deposit = web3.toBigNumber('0x8000000000000000000000000000000000000000000000000000000000000001');
        // console.log(min_deposit);
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        await shouldHaveException(async () => {
            await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        }, "Should has an error");
 
    });

    it("S3: check if provider try to publish offering with zero min_deposit", async () => {
        // console.log(web3);
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        await shouldHaveException(async () => {
            await psc.registerServiceOffering(offering_hash, 0, 2, {from:vendor});
        }, "Should has an error");
 
    });

    it("S4: check if client try to create channel with insufficient deposit value", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        await shouldHaveException(async () => {
            await psc.createChannel(vendor, offering_hash, 19, authentication_hash, {from:client});
        }, "Should has an error");

    });

    it("S5: check if client try to create channel with insufficient internal balance", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(20, {from:client});
        // TODO check balance
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        await shouldHaveException(async () => {
            await psc.createChannel(vendor, offering_hash, 21, authentication_hash, {from:client});
        }, "Should has an error");

    });

    it("S6: check if try to close channel without signing the agent", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(client, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");

    });

    it("S7: check if try to .settle() channel without unCooperativeClose call", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

//        var uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
//        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;

        // skip blocks
        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});

        await shouldHaveException(async () => {
            await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        }, "Should has an error");
 
    });

    it("S8: check if try to .settle() channel before the expiry of the challenge_period", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;
        console.log(uClose.receipt.blockNumber);

        // skip blocks
        await prix_token.approve(psc.address, 1e8,{from:owner});
        var finalBlock;
        for(var i = 0; i < challenge_period-2; i++) finalBlock = await psc.addBalanceERC20(10, {from:owner});
        console.log(finalBlock.receipt.blockNumber);

        await shouldHaveException(async () => {
            await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        }, "Should has an error");
 
    });

    it('Trying closing channel again must get error', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');

        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");
 
    });

    it('Trying closing channel with amount of balance signature more of balance must get error.', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 200;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");

    });

    it('Trying closing channel with error of balance signature or closing signature must get error.', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        // error balance signature
        var message_hash = getBalanceSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");

        // error balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(vendor, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");

        // balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        // error close signature
        var message_hash = getCloseSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");

        // balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        // error close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(client, message_hash);

        await shouldHaveException(async () => {
            await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        }, "Should has an error");


    });

    it('Closing channel by uncooperative of sender', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;

        // skip blocks
        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});

        var settle = await psc.settle(vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.settle"] = settle.receipt.gasUsed;


        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');
 
    });

    it('S9: uncooperative close, trying to close not exist channel', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var not_exist_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, not_exist_hash, sum, {from: client});
        }, "Should has an error");

    });

    it('S10: uncooperative close, try to close channel twice', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var uClose = await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        gasUsage["psc.uncooperativeClose"] = uClose.receipt.gasUsed;

        await shouldHaveException(async () => {
            await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, {from: client});
        }, "Should has an error");
 
    });

    it('S11: uncooperative close, try to close with insufficient internal balance', async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;

        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 1e8, authentication_hash, {from:client});
        gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        await shouldHaveException(async () => {
            await psc.uncooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, 1e8+1, {from: client});
        }, "Should has an error");
    });

    it("measuring gas consumption for other members:", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        // gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var topUp = await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});
        gasUsage["psc.topUp"] = topUp.receipt.gasUsed;

        var channelInfo = await psc.getChannelInfo(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.getChannelInfo"] = await psc.getChannelInfo.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        var publishServiceOfferingEndpoint = await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});
        gasUsage["psc.publishServiceOfferingEndpoint"] =  await psc.publishServiceOfferingEndpoint.estimateGas(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        // gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        // etc
        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});

        gasUsage["psc.popupServiceOffering"] = await psc.popupServiceOffering.estimateGas(offering_hash, {from:vendor});
        gasUsage["psc.extractBalanceProofSignature"] = await psc.extractBalanceProofSignature.estimateGas(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, {from:vendor});
        gasUsage["psc.extractClosingSignature"] = await psc.extractBalanceProofSignature.estimateGas(client, channel.receipt.blockNumber, offering_hash, sum, close_signature, {from:client});
        gasUsage["psc.getKey"] = await psc.getKey.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        gasUsage["psc.removeServiceOffering"] = await psc.removeServiceOffering.estimateGas(offering_hash, {from:vendor});
 
    });

    it("S12: try to publish endpoint from someone else's name", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        // gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        await shouldHaveException(async () => {
            await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:owner});
        }, "Should has an error");

    });

    it("S13: try to remove unexist offering", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        var unexist_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');
        await shouldHaveException(async () => {
            await psc.removeServiceOffering(unexist_offering_hash, {from:vendor});
        }, "Should has an error");
 
    });

    it("S14: try to remove offering from someone else's name", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        await shouldHaveException(async () => {
            await psc.removeServiceOffering(offering_hash, {from:client});
        }, "Should has an error");
 
    });

    it("S15: try to remove offering before the expiry of the challenge_period", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        // gasUsage["psc.createChannel"] = channel.receipt.gasUsed;


        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        // gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        await shouldHaveException(async () => {
            await psc.removeServiceOffering(offering_hash, {from:vendor});
        }, "Should has an error");
        // etc
        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});
        // now should be ok
        await psc.removeServiceOffering(offering_hash, {from:vendor});

 
    });

    it("S16: try to popup unexist offering", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        // gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var topUp = await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});
        gasUsage["psc.topUp"] = topUp.receipt.gasUsed;

        var channelInfo = await psc.getChannelInfo(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.getChannelInfo"] = await psc.getChannelInfo.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        var publishServiceOfferingEndpoint = await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});
        gasUsage["psc.publishServiceOfferingEndpoint"] =  await psc.publishServiceOfferingEndpoint.estimateGas(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        // gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});

        var unexist_offering_hash = "0x" + abi.soliditySHA3(['string'],['ups']).toString('hex');
        await shouldHaveException(async () => {
            await psc.popupServiceOffering(unexist_offering_hash, {from:vendor});
        }, "Should has an error");
 
    });

    it("S17: try to popup from someone else's name", async () => {
        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        var approve = await prix_token.approve(psc.address, 1e8,{from:vendor});
        // gasUsage["token.approve"] = approve.receipt.gasUsed;

        var block = await psc.addBalanceERC20(1e8, {from:vendor});
        // gasUsage["psc.addBalanceERC20"] = block.receipt.gasUsed;
        //
        var offering_hash = "0x" + abi.soliditySHA3(['string'],['offer']).toString('hex');
        var offering = await psc.registerServiceOffering(offering_hash, 20, 10, {from:vendor});
        // gasUsage["psc.registerServiceOffering"] = offering.receipt.gasUsed;

        var ClientApprove = await prix_token.approve(psc.address, 1e8,{from:client});
        // gasUsage["token.approve"] = ClientApprove.receipt.gasUsed;

        var ClientBlock = await psc.addBalanceERC20(1e8, {from:client});
        // gasUsage["psc.addBalanceERC20"] = ClientBlock.receipt.gasUsed;

        var authentication_hash = "0x" + abi.soliditySHA3(['string'],['authentication message']).toString('hex');
        var channel = await psc.createChannel(vendor, offering_hash, 20, authentication_hash, {from:client});
        // gasUsage["psc.createChannel"] = channel.receipt.gasUsed;

        var topUp = await psc.topUpChannel(vendor, channel.receipt.blockNumber, offering_hash, 10, {from:client});
        gasUsage["psc.topUp"] = topUp.receipt.gasUsed;

        var channelInfo = await psc.getChannelInfo(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});
        gasUsage["psc.getChannelInfo"] = await psc.getChannelInfo.estimateGas(client, vendor, channel.receipt.blockNumber, offering_hash, {from:client});

        var publishServiceOfferingEndpoint = await psc.publishServiceOfferingEndpoint(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});
        gasUsage["psc.publishServiceOfferingEndpoint"] =  await psc.publishServiceOfferingEndpoint.estimateGas(client, offering_hash, channel.receipt.blockNumber, offering_hash, {from:vendor});

        var sum = 10;
        //balance signature
        var message_hash = getBalanceSignature(vendor, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, channel.receipt.blockNumber, offering_hash, sum, psc.address);
        var close_signature = web3.eth.sign(vendor, message_hash);

        var cClose = await psc.cooperativeClose(vendor, channel.receipt.blockNumber, offering_hash, sum, balance_signature, close_signature, {from: vendor});
        // gasUsage["psc.cooperativeClose"] = cClose.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber()/1e8, 4, 'balance of vendor must be 4 prix');
        var ret = await psc.returnBalanceERC20(20, {from:vendor});
        // gasUsage["psc.returnBalanceERC20"] = ret.receipt.gasUsed;

        assert.equal((await prix_token.balanceOf(vendor)).toNumber(), 4e8+20, 'balance of sender must be 4e8+20');

        await prix_token.approve(psc.address, 1e8,{from:owner});
        for(var i = 0; i < challenge_period; i++) await psc.addBalanceERC20(10, {from:owner});

        await shouldHaveException(async () => {
            await psc.popupServiceOffering(offering_hash, {from:client});
        }, "Should has an error");
 
    });

    it('trying to send money directly to contract (should throw exception)', async () => {
        const balanceBefore = await web3.eth.getBalance(psc.address);
        await shouldHaveException(async () => {
            await web3.eth.sendTransaction({from: owner, to: psc.address, value: 1000});
        }, "Should has an error");
        const balanceAfter = await web3.eth.getBalance(psc.address);

        assert.equal(balanceBefore.eq(balanceAfter), true, 'balance must be not changed');
    });


});

import increaseTime, { duration } from 'zeppelin-solidity/test/helpers/increaseTime';
import moment from 'moment';
var abi = require('ethereumjs-abi');
const utils = require('ethereumjs-util');



var Prix_token = artifacts.require("../contracts/Token.sol");
var Prix2_token = artifacts.require("../contracts/Token2.sol");
var Micropay = artifacts.require("../contracts/Micropay.sol");
var Sale = artifacts.require("../contracts/Sale.sol");


contract('Micropay', (accounts) => {
    let owner, wallet, client, client1, client_wl, prix_token, prix2_token, micropay, startTime, endTime;
    let testMaxTokens, testMaxEthers, testMinEthers, testRate, sale;

    before(async () => {
        owner = web3.eth.accounts[0];
        wallet = web3.eth.accounts[1];
        client = web3.eth.accounts[2];
        client1 = web3.eth.accounts[3];
        client_wl = web3.eth.accounts[4];
    });

    beforeEach(async function () {
        startTime = web3.eth.getBlock('latest').timestamp + duration.weeks(1);

        sale = await Sale.new(startTime, wallet);
        await sale.getFreeTokens(client,5e8);
        prix_token = await Prix_token.at(await sale.token());

        micropay = await Micropay.new(await sale.token());
        //prix2_token = await Prix2_token.at(await micropay.prix2_token());
        //await token.approve(micropay.address, 1e18,{from:client});
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


    let getBalanceSignature = function(reciver, blockNumber, balance, contractAddress){
        var message_hash = abi.soliditySHA3(['bytes32','bytes32'],
            [abi.soliditySHA3(['string','string','string','string','string'],['string message_id',
                'address receiver',
                'uint32 block_created',
                'uint256 balance',
                'address contract']),
                abi.soliditySHA3(['string','address','uint32','uint256','address'],[
                    'Sender balance proof signature',
                    reciver,
                    blockNumber,
                    balance,
                    contractAddress]
                )]
        ).toString('hex');

        return message_hash;
    }

    let getCloseSignature = function (sender, blockNumber, balance, contractAddress){
        var message_hash = abi.soliditySHA3(['bytes32','bytes32'],
            [abi.soliditySHA3(['string','string','string','string','string'],
                ['string message_id',
                'address sender',
                'uint32 block_created',
                'uint256 balance',
                'address contract']),
                abi.soliditySHA3(['string','address','uint32','uint256','address'],[
                    'Receiver closing signature',
                    sender,
                    blockNumber,
                    balance,
                    contractAddress]
                )]
        ).toString('hex');
        return message_hash;
    }


    it("Will be opening deposit and full has closed deposit cooperative", async () => {
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');

        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        assert.equal((await prix_token.balanceOf(micropay.address)).toNumber()/1e8, 1, "after start deposit balance of micropay contract must be 1 prix");

        var sum = 1e8;
        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 4, 'balance of sender must be 4 prix');
        assert.equal((await prix_token.balanceOf(client1)).toNumber()/1e8, 1, 'balance of reciver must be 1 prix');
    });

    it('Will be opening deposit and part of deposit has closed cooperative', async () => {
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 5, 'before deposit balance of sender must be 5 prix');
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});
        assert.equal((await prix_token.balanceOf(micropay.address)).toNumber()/1e8, 1, "after start deposit balance of micropay contract must be 1 prix");

        var sum = 0.5*1e8;
        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 4.5, 'balance of sender must be 4.5 prix');
        assert.equal((await prix_token.balanceOf(client1)).toNumber()/1e8, 0.5, 'balance of reciver must be 0.5 prix');
    });

    it('Trying closing deposit again must get error', async () => {
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        var sum = 1e8;
        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 4, 'balance of sender must be 4 prix');
        assert.equal((await prix_token.balanceOf(client1)).toNumber()/1e8, 1, 'balance of reciver must be 1 prix');

        await shouldHaveException(async () => {
            await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        }, "Should has an error");
    });


    it('Trying closing deposit with amount of balance signature more of balance must get error.', async () => {
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        var sum = 2e8;
        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await shouldHaveException(async () => {
            await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        }, "Should has an error");
    });

    it('Trying closing deposit with amount more of balance must get error.', async () => {
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        var sum = 2e8;
        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, 1e8, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await shouldHaveException(async () => {
            await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        }, "Should has an error");
    });


    it('Trying closing deposit with error of balance signature or closing signature must get error.', async () => {
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        var sum = 1e8;
        //Erorr balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client1, message_hash);

        //Close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client1, message_hash);

        await shouldHaveException(async () => {
            await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        }, "Should has an error");

        //balance signature
        var message_hash = getBalanceSignature(client1, block.receipt.blockNumber, sum, micropay.address);
        var balance_signature = web3.eth.sign(client, message_hash);

        //Error close signature
        var message_hash = getCloseSignature(client, block.receipt.blockNumber, sum, micropay.address);
        var close_signature = web3.eth.sign(client, message_hash);

        await shouldHaveException(async () => {
            await micropay.cooperativeClose(client1,block.receipt.blockNumber, sum, balance_signature, close_signature, {from: client1});
        }, "Should has an error");
    });

    it('Clousing deposit by uncooperative of sender', async () => {
        await prix_token.approve(micropay.address, 1e8,{from:client});
        var block = await micropay.deposit(client1, 1e8, {from:client});

        var sum = 1e8;
        await micropay.uncooperativeClose(client1, block.receipt.blockNumber, sum, {from:client});
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 4, 'balance of sender must be 4 prix');
        await micropay.settle(client1, block.receipt.blockNumber, {from:client});
        assert.equal((await prix_token.balanceOf(client)).toNumber()/1e8, 5, 'balance of sender must be 5 prix');

    });


});

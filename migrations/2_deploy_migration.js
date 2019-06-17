// 15387feb21221353f149073f2ab8f97076f44c29 
const fs = require('fs');

const ERC20 = artifacts.require("./ERC20.sol");
const ECVerify = artifacts.require("./lib/ECVerify.sol");
const Ownable = artifacts.require("openzeppelin-solidity/contracts/ownership/Ownable.sol");

const MultiOwners = artifacts.require("MultiOwners.sol");


var PSC = artifacts.require("./PrivatixServiceContract.sol");
const Token = artifacts.require("./Token.sol");
const Sale = artifacts.require("./Sale.sol");
const config = require(`../targets/${process.env.TARGET}.json`);

function saveAbi(){
    save(JSON.stringify(Sale.abi, null, '\t'), "./sale.abi");
    save(JSON.stringify(Token.abi, null, '\t'), "./token.abi");
    save(JSON.stringify(PSC.abi, null, '\t'), "./psc.abi");
};

function save(abi, name){
    fs.writeFileSync(name, abi);
};

module.exports = async function(deployer, network, accounts) {

    const deploy = async function(tokenContract){
        const token = await tokenContract.token();
        return deployer.deploy(PSC, token, accounts[0], config.popup_period, config.remove_period, config.challenge_period).then(saveAbi);
    };

    if(config.saleAddress && config.saleAddress !== '') {
        try {
            const tokenContract = await Sale.at(config.saleAddress);
            return deploy(tokenContract);
        } catch(e){
            console.log(e);
        }
    } else {
        const startTime = Date.now() + 60000;
        deployer.deploy(Sale, startTime, accounts[0]).then(function (){

            Sale.at(Sale.address).then(function(instance){
                instance.getFreeTokens(accounts[0], 2e8).then(function(){
                    deploy(instance);
                });
            });
        });
    }
};

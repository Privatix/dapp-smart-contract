// 15387feb21221353f149073f2ab8f97076f44c29 
const fs = require('fs');

const ERC20 = artifacts.require("zeppelin-solidity/contracts/token/ERC20/StandardToken.sol");
const SafeMath = artifacts.require("zeppelin-solidity/contracts/math/SafeMath.sol");
const ECVerify = artifacts.require("./lib/ECVerify.sol");
const Ownable = artifacts.require("zeppelin-solidity/contracts/ownership/Ownable.sol");

const MultiOwners = artifacts.require("MultiOwners.sol");


var PSC = artifacts.require("./PrivatixServiceContract.sol");
const Token = artifacts.require("./Token.sol");
const Sale = artifacts.require("./Sale.sol");
const challenge_period = 510;

function saveAbi(){
    save(JSON.stringify(Sale.abi, null, '\t'), "./sale.abi");
    save(JSON.stringify(Token.abi, null, '\t'), "./token.abi");
    save(JSON.stringify(PSC.abi, null, '\t'), "./psc.abi");
};

function save(abi, name){
    fs.writeFileSync(name, abi);
};

module.exports = async function(deployer, network, accounts) {
    const startTime = Date.now() + 60000;
    deployer.deploy(Token);
    deployer.deploy(MultiOwners);
    deployer.deploy(SafeMath);
    deployer.deploy(ECVerify);
    deployer.deploy(Ownable);
    deployer.link(MultiOwners, Sale);
    deployer.link(Token, [Sale, PSC]);
    deployer.link(SafeMath, PSC);
    deployer.link(ECVerify, PSC);
    deployer.link(Ownable, PSC);
    deployer.deploy(Sale, startTime, accounts[0]).then(function (){

//        console.log(JSON.stringify(Sale));
        Sale.at(Sale.address).then(function(instance){
            instance.getFreeTokens(accounts[0], 2e8).then(function(){
                instance.token().then(function(token){
                    deployer.deploy(PSC, token, accounts[0], challenge_period).then(saveAbi);
                });
            });
        });
    });
};

pragma solidity ^0.4.15;

import 'zeppelin-solidity/contracts/token/MintableToken.sol';

contract Token2 is MintableToken {

    string public constant name = 'Privatix v2';
    string public constant symbol = 'PRIXv2';
    uint8 public constant decimals = 8;
    
    function transferFrom(address from, address to, uint256 value) returns (bool) {
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value) returns (bool) {
        return super.transfer(to, value);
    }

}

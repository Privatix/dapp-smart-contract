pragma solidity ^0.4.18;

import 'openzeppelin-solidity/contracts/token/ERC20/MintableToken.sol';


contract Token is MintableToken {

    string public constant name = 'Privatix';
    string public constant symbol = 'PRIX';
    uint8 public constant decimals = 8;
    
    function transferFrom(address from, address to, uint256 value) returns (bool) {
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value) returns (bool) {
        return super.transfer(to, value);
    }

}

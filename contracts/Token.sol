pragma solidity ^0.5.8;

import 'openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol';


contract Token is ERC20Mintable {

    string public constant name = 'Privatix';
    string public constant symbol = 'PRIX';
    uint8 public constant decimals = 8;
    
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        return super.transfer(to, value);
    }

}

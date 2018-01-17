pragma solidity ^0.4.15;


contract MultiOwners {

    event AccessGrant(address indexed owner);
    event AccessRevoke(address indexed owner);
    
    mapping(address => bool) owners;

    function MultiOwners() {
        owners[msg.sender] = true;
    }

    modifier onlyOwner() { 
        require(owners[msg.sender] == true);
        _; 
    }

    function isOwner() constant returns (bool) {
        return owners[msg.sender] ? true : false;
    }

    function checkOwner(address maybe_owner) constant returns (bool) {
        return owners[maybe_owner] ? true : false;
    }


    function grant(address _owner) onlyOwner {
        owners[_owner] = true;
        AccessGrant(_owner);
    }

    function revoke(address _owner) onlyOwner {
        require(msg.sender != _owner);
        owners[_owner] = false;
        AccessRevoke(_owner);
    }
}

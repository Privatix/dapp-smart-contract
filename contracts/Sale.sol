pragma solidity ^0.4.15;

import './Token.sol';
import './MultiOwners.sol';


contract Sale is MultiOwners {

    // totalEthers received
    uint256 public totalEthers;

    // Ssale token
    Token public token;

    // Withdraw wallet
    address public wallet;

    // Maximum available to sell tokens
    uint256 public maximumTokens;

    // Minimal Eth
    uint256 public minimalEther;

    // Minimal tokens
    uint256 public minFreePrixByTrans;

    // Maximum tokens
    uint256 public maxFreePrixByTrans;

    // Token per ether
    uint256 public weiPerToken;

    // start and end timestamp where investments are allowed (both inclusive)
    uint256 public startTime;
    uint256 public endTime;

    // 
    mapping(address => uint256) public etherBalances;


    event TokenPurchase(address indexed beneficiary, uint256 value, uint256 amount);

    modifier validPurchase(address contributor) {
        bool withinPeriod = (now >= startTime && now <= endTime);
        bool nonZeroPurchase = msg.value != 0;
        require(withinPeriod && nonZeroPurchase);

        _;        
    }

    modifier isStarted() {
        require(now >= startTime);

        _;        
    }

    modifier isExpired() {
        require(now > endTime);

        _;        
    }

    constructor(uint256 _startTime, address _wallet) public {
        require(_startTime >=  now);
        require(_wallet != 0x0);

        token = new Token();

        wallet = _wallet;
        startTime = _startTime;

        minimalEther = 1e16; // 0.01 ether
        minFreePrixByTrans = 1; // 0.00000001 prix
        maxFreePrixByTrans = 10e8; //10 prix
        endTime = _startTime + 10 years;
        weiPerToken = 1e18 / 100e8; // token price
    }


    /*
     * @dev fallback for processing ether
     */
    function() public payable {
        return buyTokens(msg.sender);
    }

    /*
     * @dev sell token and send to contributor address
     * @param contributor address
     */
    function buyTokens(address contributor) payable public {
        uint256 amount = msg.value / weiPerToken;
  
        require(contributor != 0x0) ;
        require(minimalEther <= msg.value);
        //require(minPrixByTrans <= amount && maxPrixByTrans >= amount);

        token.mint(contributor, amount);
        emit TokenPurchase(contributor, msg.value, amount);
    }

    function getFreeTokens(address contributor, uint256 amount) public {
        if (contributor == 0x0) {
            contributor = msg.sender;
        }
        require(minFreePrixByTrans <= amount && maxFreePrixByTrans >= amount);

        token.mint(contributor, amount);
        emit TokenPurchase(contributor, amount, 0);
    }

    // @return true if crowdsale event has ended
    function running() public constant returns (bool) {
        return now >= startTime && !(now > endTime);
    }
}

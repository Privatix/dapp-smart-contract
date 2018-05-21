pragma solidity ^0.4.18;


/**
 * @title SafeMath
 * @dev Math operations with safety checks that throw on error
 */
library SafeMath192 {

  /**
  * @dev Multiplies two numbers, throws on overflow.
  */
  function mul(uint192 a, uint192 b) internal pure returns (uint192) {
    if (a == 0) {
      return 0;
    }
    uint192 c = a * b;
    assert(c / a == b);
    return c;
  }

  /**
  * @dev Subtracts two numbers, throws on overflow (i.e. if subtrahend is greater than minuend).
  */
  function sub(uint192 a, uint192 b) internal pure returns (uint192) {
    assert(b <= a);
    return a - b;
  }

  /**
  * @dev Adds two numbers, throws on overflow.
  */
  function add(uint192 a, uint192 b) internal pure returns (uint192) {
    uint192 c = a + b;
    assert(c >= a);
    return c;
  }
}

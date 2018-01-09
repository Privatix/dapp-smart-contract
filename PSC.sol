pragma solidity ^0.4.18;

import './Token/ERC20.sol';
import './lib/ECVerify.sol';
import './Token/Ownable.sol';
import './lib/SafeMath.sol';


/// @title Privatix Service Contract.
contract PrivatixServiceContract is Ownable {
    using SafeMath for uint256;
    /*
     *  Data structures
     */

    // 1) Number of blocks to wait from an uncooperativeClose initiated by the Client
    // in order to give the Agent a chance to respond with a balance proof
    // in case the sender cheats. After the challenge period, the sender can settle
    // and delete the channel.
    // 2) Number of blocks Agent will wait from registerServiceOffering or from createChannel before
    // he can delete service offering and recieve Agent's deposit back.
    uint32 public challenge_period;

    // Contract semantic version
    string public constant meta_version = '0.1.0';

    // We temporarily limit total token deposits in a channel to 300 PRIX.
    // This is just for the bug bounty release, as a safety measure.
    uint256 public constant channel_deposit_bugbounty_limit = 10 ** 8 * 300;

    ERC20 public token;

    mapping (bytes32 => Channel) public channels;
    mapping (bytes32 => ClosingRequest) public closing_requests;
    mapping (address => uint256) public internal_balances;
    mapping(bytes32 => ServiceOffering) private service_offering_s;

    // 32 bytes + 29 bytes
    struct ServiceOffering{
      uint256 min_deposit;  // bytes32 - Minumum deposit that Client should place to open state channel. @@ generally uint192 should suffice
      address agent_address; //bytes20 - Address of Agent.
      uint16 max_supply; // bytes2 - Maximum supply of services according to service offerings.
      uint16 current_supply; // bytes2 - Currently remianing free capcity.
      uint32 update_block_number; //bytes4 - Last block number when service offering was created, poped-up or channel opened.
      bool isActive; // byte - Flag, shows SO is empty/created/deleted. @@ Bool occupy byte, isn't it?
    }

    // 24 bytes (deposit) + 4 bytes (block number)
    struct Channel {
        // uint192 is the maximum uint size needed for deposit based on a
        // 10^8 * 10^18 token totalSupply.
        uint192 deposit;

        // Block number at which the channel was opened. Used in creating
        // a unique identifier for the channel between a sender and receiver.
        // Supports creation of multiple channels between the 2 parties and prevents
        // replay of messages in later channels.
        uint32 open_block_number;
    }

    // 24 bytes (deposit) + 4 bytes (block number)
    struct ClosingRequest {
        // Number of tokens owed by the Client when closing the channel.
        uint192 closing_balance;

        // Block number at which the challenge period ends, in case it has been initiated.
        uint32 settle_block_number;
    }

    /*
     *  Events
     */

    event LogChannelCreated(
        address indexed _client,
        address indexed _agent,
        bytes32 indexed _offering_hash,
        uint192 _deposit,
        bytes32 _authentication_hash);
    event LogChannelToppedUp(
        address indexed _client,
        address indexed _agent,
        uint32 indexed _open_block_number,
        bytes32 _offering_hash,
        uint192 _added_deposit);
    event LogChannelCloseRequested(
        address indexed _client,
        address indexed _agent,
        uint32 indexed _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance);
    event LogServiceOfferingCreated(
        address indexed _agent_address,
        bytes32 indexed _offering_hash,
        uint256 _min_deposit,
        uint16 _current_supply);
    event LogServiceOfferingDeleted(
      bytes32 indexed _offering_hash);
    event LogServiceOfferingEndpoint(
      address indexed _client,
      bytes32 indexed _offering_hash,
      uint32 indexed _open_block_number,
      bytes32 _endpoint_hash);
    event LogServiceOfferingSupplyChanged(
      bytes32 indexed _offering_hash,
      uint16 _current_supply);
    event LogServiceOfferingPopedUp(
      bytes32 indexed _offering_hash);
    event LogCooperativeChannelClose(
      address indexed _client,
      address indexed _agent,
      uint32 indexed _open_block_number,
      bytes32 _offering_hash,
      uint192 _balance);
    event LogUnCooperativeChannelClose(
      address indexed _client,
      address indexed _agent,
      uint32 indexed _open_block_number,
      bytes32 _offering_hash,
      uint192 _balance);
    /*
     *  Modifiers
     */

    /*
     *  Constructor
     */

    /// @notice Constructor for creating the Privatix Service Contract.
    /// @param _token_address The address of the Token used by the uRaiden contract.
    /// @param _challenge_period A fixed number of blocks representing the challenge period.
    /// We enforce a minimum of 500 blocks waiting period.
    /// after a sender requests the closing of the channel without the receiver's signature.
    function PrivatixServiceContract(
      address _token_address,
      uint32 _challenge_period
      ) public {
        require(_token_address != 0x0);
        require(addressHasCode(_token_address));
        require(_challenge_period >= 500);

        token = ERC20(_token_address);

        // Check if the contract is indeed a token contract
        require(token.totalSupply() > 0);

        challenge_period = _challenge_period;

    }

    /*
     *  External functions
     */

    /// @notice Creates a new internal balance by transferring from PTC ERC20 token.
    /// @param _value Token transfered to intenal balance.
    function addBalanceERC20(uint192 _value) external {
      internal_balances[msg.sender] = internal_balances[msg.sender].add(_value);
      // transferFrom deposit from sender to contract
      // ! needs prior approval from user
      require(token.transferFrom(msg.sender, address(this), _value));
    }

    /// @notice Returns tokens from internal balance to PTC ERC20 token.
    /// @param _value Token amount to return.
    function returnBalanceERC20(uint192 _value) external {
      internal_balances[msg.sender] = internal_balances[msg.sender].sub(_value);
      require(token.transfer(msg.sender, _value));
    }

    /// @notice Creates a new channel between `msg.sender` (Client) and Agent and places
    /// the `_deposit` tokens from internal_balances to channel.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _deposit The amount of tokens that the Client escrows.
    /// @param _authentication_hash Hash of authentication message, which is delivered off-chain.
    function createChannel(address _agent_address, bytes32 _offering_hash, uint192 _deposit, bytes32 _authentication_hash) external {
        require(_deposit >= service_offering_s[_offering_hash].min_deposit);
        decreaseOfferingSupply(_agent_address, _offering_hash);
        createChannelPrivate(msg.sender, _agent_address, _offering_hash, _deposit);
        internal_balances[msg.sender] = internal_balances[msg.sender].sub(_deposit);
        LogChannelCreated(_client_address, _agent_address, _offering_hash, _deposit, _authentication_hash);
    }

    /// @notice Increase the channel deposit with `_added_deposit`.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _added_deposit The added token deposit with which the current deposit is increased.
    function topUpChannel(
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _added_deposit)
        external
    {
        updateInternalBalanceStructs(
            msg.sender,
            _agent_address,
            _open_block_number,
            _offering_hash,
            _added_deposit
        );

        internal_balances[msg.sender] = internal_balances[msg.sender].sub(_added_deposit);
    }

    /// @notice Function called by the Client or Agent, with all the needed
    /// signatures to close the channel and settle immediately.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _balance The amount of tokens owed by the Client to the Agent.
    /// @param _balance_msg_sig The balance message signed by the Client.
    /// @param _closing_sig The Agent's signed balance message, containing the Client's address.
    function cooperativeClose(
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance,
        bytes _balance_msg_sig,
        bytes _closing_sig)
        external
    {
        // Derive Client address from signed balance proof
        address sender = extractBalanceProofSignature(_agent_address, _open_block_number, _offering_hash, _balance, _balance_msg_sig);

        // Derive Agent address from closing signature
        address receiver = extractClosingSignature(sender, _open_block_number, _offering_hash, _balance, _closing_sig);
        require(receiver == _agent_address);

        // Both signatures have been verified and the channel can be settled.
        settleChannel(sender, receiver, _open_block_number, _offering_hash, _balance);
        LogCooperativeChannelClose(sender, receiver, _open_block_number, _offering_hash, _balance);
    }

    /// @notice Client requests the closing of the channel and starts the challenge period.
    /// This can only happen once.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between
    /// the Client and Agnet was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _balance The amount of tokens owed by the Client to the Agent.
    function uncooperativeClose(
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance)
        external
    {
        bytes32 key = getKey(msg.sender, _agent_address, _open_block_number, _offering_hash);

        require(channels[key].open_block_number > 0);
        require(closing_requests[key].settle_block_number == 0);
        require(_balance <= channels[key].deposit);

        // Mark channel as closed
        closing_requests[key].settle_block_number = uint32(block.number) + challenge_period;
        require(closing_requests[key].settle_block_number > block.number); // @@ Consider to use SafeMath instead
        closing_requests[key].closing_balance = _balance;

        LogChannelCloseRequested(msg.sender, _agent_address, _open_block_number, _offering_hash, _balance);
    }


    /// @notice Function called by the Client after the challenge period has ended, in order to
    /// settle and delete the channel, in case the Agent has not closed the channel himself.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between
    /// the Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    function settle(address _agent_address, uint32 _open_block_number, bytes32 _offering_hash) external {
        bytes32 key = getKey(msg.sender, _agent_address, _open_block_number, _offering_hash);

        // Make sure an uncooperativeClose has been initiated
        require(closing_requests[key].settle_block_number > 0);

        // Make sure the challenge_period has ended
	    require(block.number > closing_requests[key].settle_block_number);

        settleChannel(msg.sender, _agent_address, _open_block_number, _offering_hash,
            closing_requests[key].closing_balance
        );

        LogUnCooperativeChannelClose(msg.sender, _agent_address, _open_block_number,
          _offering_hash, closing_requests[key].closing_balance
        );
    }

    /// @notice Function for retrieving information about a channel.
    /// @param _client_address The address of Client hat sends tokens.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @return Channel information (unique_identifier, deposit, settle_block_number, closing_balance).
    function getChannelInfo(
        address _client_address,
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash)
        external
        view
        returns (bytes32, uint192, uint32, uint192)
    {
        bytes32 key = getKey(_client_address, _agent_address, _open_block_number, _offering_hash);
        require(channels[key].open_block_number > 0);

        return (
            key,
            channels[key].deposit,
            closing_requests[key].settle_block_number,
            closing_requests[key].closing_balance
        );
    }

    /// @notice Called by Agent to publish service endpoint
    /// @param _client_address The address of Client that sends tokens.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _endpoint_hash Hash of endpoint message delivered off-chain.
    function publishServiceOfferingEndpoint(address _client_address, bytes32 _offering_hash, uint32 _open_block_number, bytes32 _endpoint_hash) external
    {
      require(service_offering_s[_offering_hash].agent_address == msg.sender);
      LogServiceOfferingEndpoint(_client_address, _offering_hash, _open_block_number, _endpoint_hash);
    }


    /*
     *  Public functions
     */

    /// @notice Called by Agent to register service offering
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _min_deposit Minumum deposit that Client should place to open state channel.
    /// @param _max_supply Maximum supply of services according to service offerings.
    /// @return True on sucess
    function registerServiceOffering (
     bytes32 _offering_hash,
     uint256 _min_deposit,
     uint16 _max_supply)
     public
     returns(bool success)
    {
      require(service_offering_s[_offering_hash].update_block_number > 0); // Service offering already exists
      require(_min_deposit*_max_supply > channel_deposit_bugbounty_limit); //Agent deposit greater than max allowed @@ to check overflow
      require(_min_deposit > 0); // zero deposit is not allowed

      service_offering_s[_offering_hash].agent_address = msg.sender;
      service_offering_s[_offering_hash].min_deposit = _min_deposit;
      service_offering_s[_offering_hash].max_supply = _max_supply;
      service_offering_s[_offering_hash].current_supply = _max_supply;
      service_offering_s[_offering_hash].update_block_number = uint32(block.number);
      service_offering_s[_offering_hash].isActive = true;

      // Substitute deposit amount for each offering slot from agent's internal balance
      internal_balances[msg.sender] = internal_balances[msg.sender].sub(_min_deposit * _max_supply);

      LogServiceOfferingCreated(msg.sender, _offering_hash, _min_deposit, _max_supply);

      return true;
    }

    /// @notice Called by Agent to permanently deactivate service offering.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @return True on sucess
    function removeServiceOffering (
     bytes32 _offering_hash)
     public
     returns(bool success)
    {
      require(service_offering_s[_offering_hash].isActive);
      // only creator can delete his offering
      assert(service_offering_s[_offering_hash].agent_address == msg.sender);
      // At leasted challenge_period blocks were mined after last offering structure update
      require(service_offering_s[_offering_hash].update_block_number + challenge_period > block.number);
      // return Agent's deposit back to his internal balance @@ to check overflow
      internal_balances[msg.sender] = internal_balances[msg.sender].add(
        service_offering_s[_offering_hash].min_deposit * service_offering_s[_offering_hash].max_supply
      );
      // this flag marks offering as deleted
      service_offering_s[_offering_hash].isActive = false;

      LogServiceOfferingDeleted(_offering_hash);

      return true;
    }

    /// @notice Called by Agent to register service offering
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _min_deposit Minumum deposit that Client should place to open state channel.
    /// @param _max_supply Maximum supply of services according to service offerings.
    /// @return True on sucess
    function popupServiceOffering (bytes32 _offering_hash) public returns(bool success)
    {
      require(service_offering_s[_offering_hash].update_block_number > 0); // Service offering already exists
      require(service_offering_s[_offering_hash].agent_address == msg.sender);
      require(block.number > service_offering_s[_offering_hash].update_block_number);

      service_offering_s[_offering_hash].update_block_number = uint32(block.number);

      LogServiceOfferingPopedUp(_offering_hash);

      return true;
    }

    /// @notice Returns the sender address extracted from the balance proof.
    /// dev Works with eth_signTypedData https://github.com/ethereum/EIPs/pull/712.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _balance The amount of tokens owed by the Client to the Agent.
    /// @param _balance_msg_sig The balance message signed by the Client.
    /// @return Address of the balance proof signer.
    function extractBalanceProofSignature(
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance,
        bytes _balance_msg_sig)
        public
        view
        returns (address)
    {
        // The variable names from below will be shown to the sender when signing
        // the balance proof, so they have to be kept in sync with the Dapp client.
        // The hashed strings should be kept in sync with this function's parameters
        // (variable names and types).
        // ! Note that EIP712 might change how hashing is done, triggering a
        // new contract deployment with updated code.
        bytes32 message_hash = keccak256(
            keccak256(
                'string message_id',
                'address receiver',
                'uint32 block_created',
                'bytes32 offering_hash',
                'uint192 balance',
                'address contract'
            ),
            keccak256(
                'Sender balance proof signature',
                _agent_address,
                _open_block_number,
                _offering_hash,
                _balance,
                address(this)
            )
        );

        // Derive address from signature
        address signer = ECVerify.ecverify(message_hash, _balance_msg_sig);
        return signer;
    }

    /// @dev Returns the Agent address extracted from the closing signature.
    /// Works with eth_signTypedData https://github.com/ethereum/EIPs/pull/712.
    /// @param _client_address The address that sends tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _balance The amount of tokens owed by the Client to the Agent.
    /// @param _closing_sig The Agent's signed balance message, containing the Client's address.
    /// @return Address of the closing signature signer.
    function extractClosingSignature(
        address _client_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance,
        bytes _closing_sig)
        public
        view
        returns (address)
    {
        // The variable names from below will be shown to the sender when signing
        // the balance proof, so they have to be kept in sync with the Dapp client.
        // The hashed strings should be kept in sync with this function's parameters
        // (variable names and types).
        // ! Note that EIP712 might change how hashing is done, triggering a
        // new contract deployment with updated code.
        bytes32 message_hash = keccak256(
            keccak256(
                'string message_id',
                'address sender',
                'uint32 block_created',
                'bytes32 offering_hash',
                'uint192 balance',
                'address contract'
            ),
            keccak256(
                'Receiver closing signature',
                _client_address,
                _open_block_number,
                _offering_hash,
                _balance,
                address(this)
            )
        );

        // Derive address from signature
        address signer = ECVerify.ecverify(message_hash, _closing_sig);
        return signer;
    }

    /// @notice Returns the unique channel identifier used in the contract.
    /// @param _client_address The address of Client that sends tokens.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// Client and Agent was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @return Unique channel identifier.
    function getKey(
        address _client_address,
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash)
        public
        pure
        returns (bytes32 data)
    {
        return keccak256(_client_address, _agent_address, _open_block_number, _offering_hash);
    }

    /*
     *  Private functions
     */

     /// @notice Increases available service offering supply.
     /// @param _agent_address The address of Agent that created service offering.
     /// @param _offering_hash Service Offering hash that uniquely identifies it.
     /// @return True in both case, when Service Offering still active or already deactivated.
     function increaseOfferingSupply(address _agent_address, bytes32 _offering_hash)
      private
      returns (bool done)
    {
      // Verify that Agent owns this offering
      require(service_offering_s[_offering_hash].agent_address == _agent_address);
      // saving gas, as no need to update state
      if(!service_offering_s[_offering_hash].isActive) return true;

      require(service_offering_s[_offering_hash].current_supply+1 <= service_offering_s[_offering_hash].max_supply);
      service_offering_s[_offering_hash].current_supply = service_offering_s[_offering_hash].current_supply+1;

      LogServiceOfferingSupplyChanged(_offering_hash, service_offering_s[_offering_hash].current_supply);

      return true;
    }

    /// @notice Decreases available service offering supply.
    /// @param _agent_address The address of Agent that created service offering.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @return True in both case, when Service Offering still active or already deactivated.

    function decreaseOfferingSupply(address _agent_address, bytes32 _offering_hash)
     private
   {
     require(service_offering_s[_offering_hash].isActive);
     require(service_offering_s[_offering_hash].agent_address == _agent_address);
     require(service_offering_s[_offering_hash].current_supply-1 >= 0);

     service_offering_s[_offering_hash].current_supply = service_offering_s[_offering_hash].current_supply-1;
     service_offering_s[_offering_hash].update_block_number = uint32(block.number);

     LogServiceOfferingSupplyChanged(_offering_hash, service_offering_s[_offering_hash].current_supply);
   }

    /// @dev Creates a new channel between a Client and a Agent.
    /// @param _client_address The address of Client that sends tokens.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _deposit The amount of tokens that the Client escrows.
    function createChannelPrivate(address _client_address, address _agent_address, bytes32 _offering_hash, uint192 _deposit) private {
        require(_deposit <= channel_deposit_bugbounty_limit);

        uint32 open_block_number = uint32(block.number);

        // Create unique identifier from sender, receiver and current block number
        bytes32 key = getKey(_client_address, _agent_address, open_block_number, _offering_hash);

        require(channels[key].deposit == 0);
        require(channels[key].open_block_number == 0);
        require(closing_requests[key].settle_block_number == 0);

        // Store channel information
        channels[key] = Channel({deposit: _deposit, open_block_number: open_block_number});
    }

    /// @dev Updates internal balance Structures when the sender adds tokens to the channel.
    /// @param _client_address The address that sends tokens.
    /// @param _agent_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _added_deposit The added token deposit with which the current deposit is increased.
    function updateInternalBalanceStructs(
        address _client_address,
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _added_deposit)
        private
    {
        require(_added_deposit > 0);
        require(_open_block_number > 0);

        bytes32 key = getKey(_client_address, _agent_address, _open_block_number, _offering_hash);

        require(channels[key].deposit > 0);
        require(closing_requests[key].settle_block_number == 0);
        require(channels[key].deposit + _added_deposit <= channel_deposit_bugbounty_limit);

        channels[key].deposit += _added_deposit;
        assert(channels[key].deposit > _added_deposit);

        LogChannelToppedUp(_client_address, _agent_address, _open_block_number, _offering_hash, _added_deposit);
    }

    /// @dev Deletes the channel and settles by transfering the balance to the Agent
    /// and the rest of the deposit back to the Client.
    /// @param _client_address The address of Client that sends tokens.
    /// @param _agent_address The address of Agent that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _offering_hash Service Offering hash that uniquely identifies it.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    function settleChannel(
        address _client_address,
        address _agent_address,
        uint32 _open_block_number,
        bytes32 _offering_hash,
        uint192 _balance)
        private
    {
        bytes32 key = getKey(_client_address, _agent_address, _open_block_number, _offering_hash);
        Channel memory channel = channels[key];

        require(channel.open_block_number > 0);
        require(_balance <= channel.deposit);

        // Remove closed channel structures
        // channel.open_block_number will become 0
        delete channels[key];
        delete closing_requests[key];

        require(increaseOfferingSupply(_agent_address, _offering_hash));
        // Send _balance to the receiver, as it is always <= deposit
        internal_balances[_agent_address] = internal_balances[_agent_address].add(_balance);

        // Send deposit - balance back to Client
        internal_balances[_client_address] = internal_balances[_client_address].add(channel.deposit - _balance);

    }

    /*
     *  Internal functions
     */

    /// @dev Check if a contract exists.
    /// @param _contract The address of the contract to check for.
    /// @return True if a contract exists, false otherwise
    function addressHasCode(address _contract) internal pure returns (bool) {
        uint size;
        assembly {
            size := extcodesize(_contract)
        }

        return size > 0;
    }
}

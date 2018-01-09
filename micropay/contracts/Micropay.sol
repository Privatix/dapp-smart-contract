pragma solidity ^0.4.17;

import './Token.sol';
import './Token2.sol';
import './lib/ECVerify.sol';

contract Micropay {

    Token public prix_token;
    Token2 public prix2_token;

    mapping (bytes32 => Channel) public channels;
    mapping (bytes32 => ClosingRequest) public closing_requests;
    mapping (bytes32 => uint256) public withdrawn_balances;

    // Number of blocks to wait from an uncooperativeClose initiated by the sender
    // in order to give the receiver a chance to respond with a balance proof
    // in case the sender cheats. After the challenge period, the sender can settle
    // and delete the channel.
    uint32 public constant challenge_period = 500;

    // 24 bytes (deposit) + 4 bytes (block number)
    struct Channel {
        // uint192 is the maximum uint size needed for deposit based on a
        // 10^8 * 10^18 token totalSupply.
        uint256 deposit;

        // Block number at which the channel was opened. Used in creating
        // a unique identifier for the channel between a sender and receiver.
        // Supports creation of multiple channels between the 2 parties and prevents
        // replay of messages in later channels.
        uint32 open_block_number;
    }

    // 24 bytes (deposit) + 4 bytes (block number)
    struct ClosingRequest {
        // Number of tokens owed by the sender when closing the channel.
        uint256 closing_balance;

        // Block number at which the challenge period ends, in case it has been initiated.
        uint32 settle_block_number;
    }

    /*
     *  Events
     */

    event ChannelCreated(
        address indexed _sender,
        address indexed _receiver,
        uint256 _deposit);
    event ChannelToppedUp (
        address indexed _sender,
        address indexed _receiver,
        uint32 indexed _open_block_number,
        uint256 _added_deposit);
    event ChannelCloseRequested(
        address indexed _sender,
        address indexed _receiver,
        uint32 indexed _open_block_number,
        uint256 _balance);
    event ChannelSettled(
        address indexed _sender,
        address indexed _receiver,
        uint32 indexed _open_block_number,
        uint256 _balance);

    function Micropay(address _prix_token_address){
        require(_prix_token_address != 0x0);
        require(addressHasCode(_prix_token_address));

        prix_token = Token(_prix_token_address);
        prix2_token = new Token2();
        // Check if the contract is indeed a token contract
        require(prix_token.totalSupply() > 0);
    }

    function deposit(address _receiver_address, uint256 _deposit) public returns (uint32){
        // transferFrom deposit from sender to contract
        // ! needs prior approval from user
        require(prix_token.transferFrom(msg.sender, address(this), _deposit));

        //prix2_token.mint(msg.sender, _deposit);

        createChannelPrivate(msg.sender, _receiver_address, _deposit);
        return uint32(block.number);
    }


    function test(address _receiver_address, uint32 _open_block_number, uint256 _balance, bytes _balance_msg_sig) public view returns (address){

        bytes32 message_hash =
        keccak256("\x19Ethereum Signed Message:\n32",
            keccak256(
                keccak256(
                    'string message_id',
                    'address receiver',
                    'uint32 block_created',
                    'uint256 balance',
                    'address contract'
                ),
                keccak256(
                    'Sender balance proof signature',
                    _receiver_address,
                    _open_block_number,
                    _balance,
                    address(this)
                )
            )
        );
        address signer = ECVerify.ecverify(message_hash, _balance_msg_sig);

        return signer;
    }



    /// @dev Creates a new channel between a sender and a receiver.
    /// @param _sender_address The address that sends tokens.
    /// @param _receiver_address The address that receives tokens.
    /// @param _deposit The amount of tokens that the sender escrows.
    function createChannelPrivate(address _sender_address, address _receiver_address, uint256 _deposit) private {
        //require(_deposit <= channel_deposit_bugbounty_limit);

        uint32 open_block_number = uint32(block.number);

        // Create unique identifier from sender, receiver and current block number
        bytes32 key = getKey(_sender_address, _receiver_address, open_block_number);

        require(channels[key].deposit == 0);
        require(channels[key].open_block_number == 0);
        require(closing_requests[key].settle_block_number == 0);

        // Store channel information
        channels[key] = Channel({deposit: _deposit, open_block_number: open_block_number});
        ChannelCreated(_sender_address, _receiver_address, _deposit);
    }


    /// @notice Returns the unique channel identifier used in the contract.
    /// @param _sender_address The address that sends tokens.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @return Unique channel identifier.
    function getKey(
        address _sender_address,
        address _receiver_address,
        uint32 _open_block_number)
    public
    pure
    returns (bytes32 data)
    {
        return keccak256(_sender_address, _receiver_address, _open_block_number);
    }


    /// @dev Check if a contract exists.
    /// @param _contract The address of the contract to check for.
    /// @return True if a contract exists, false otherwise
    function addressHasCode(address _contract) internal constant returns (bool) {
        uint size;
        assembly {
            size := extcodesize(_contract)
        }

        return size > 0;
    }
    /// @notice Function called by the sender, receiver or a delegate, with all the needed
    /// signatures to close the channel and settle immediately.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    /// @param _balance_msg_sig The balance message signed by the sender.
    /// @param _closing_sig The receiver's signed balance message, containing the sender's address.
    function cooperativeClose(
        address _receiver_address,
        uint32 _open_block_number,
        uint256 _balance,
        bytes _balance_msg_sig,
        bytes _closing_sig)
    public
    {
        // Derive sender address from signed balance proof
        address sender = extractBalanceProofSignature(_receiver_address, _open_block_number, _balance, _balance_msg_sig);

        // Derive receiver address from closing signature
        address receiver = extractClosingSignature(sender, _open_block_number, _balance, _closing_sig);
        require(receiver == _receiver_address);

        // Both signatures have been verified and the channel can be settled.
        settleChannel(sender, receiver, _open_block_number, _balance);
    }

    /// @notice Returns the sender address extracted from the balance proof.
    /// dev Works with eth_signTypedData https://github.com/ethereum/EIPs/pull/712.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    /// @param _balance_msg_sig The balance message signed by the sender.
    /// @return Address of the balance proof signer.
    function extractBalanceProofSignature(
        address _receiver_address,
        uint32 _open_block_number,
        uint256 _balance,
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
        bytes32 message_hash =
        keccak256("\x19Ethereum Signed Message:\n32",
            keccak256(
                keccak256(
                    'string message_id',
                    'address receiver',
                    'uint32 block_created',
                    'uint256 balance',
                    'address contract'
                ),
                keccak256(
                    'Sender balance proof signature',
                    _receiver_address,
                    _open_block_number,
                    _balance,
                    address(this)
                )
            )
        );

        // Derive address from signature
        address signer = ECVerify.ecverify(message_hash, _balance_msg_sig);
        return signer;
    }

    /// @dev Returns the receiver address extracted from the closing signature.
    /// Works with eth_signTypedData https://github.com/ethereum/EIPs/pull/712.
    /// @param _sender_address The address that sends tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    /// @param _closing_sig The receiver's signed balance message, containing the sender's address.
    /// @return Address of the closing signature signer.
    function extractClosingSignature(
        address _sender_address,
        uint32 _open_block_number,
        uint256 _balance,
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
        bytes32 message_hash =
        keccak256("\x19Ethereum Signed Message:\n32",
            keccak256(
                keccak256(
                    'string message_id',
                    'address sender',
                    'uint32 block_created',
                    'uint256 balance',
                    'address contract'
                ),
                keccak256(
                    'Receiver closing signature',
                    _sender_address,
                    _open_block_number,
                    _balance,
                    address(this)
                )
            )
        );

        // Derive address from signature
        address signer = ECVerify.ecverify(message_hash, _closing_sig);
        return signer;
    }


    /// @dev Deletes the channel and settles by transfering the balance to the receiver
    /// and the rest of the deposit back to the sender.
    /// @param _sender_address The address that sends tokens.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between the
    /// sender and receiver was created.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    function settleChannel(
        address _sender_address,
        address _receiver_address,
        uint32 _open_block_number,
        uint256 _balance)
    private
    {
        bytes32 key = getKey(_sender_address, _receiver_address, _open_block_number);
        Channel memory channel = channels[key];

        require(channel.open_block_number > 0);
        require(_balance <= channel.deposit);

        // Remove closed channel structures
        // channel.open_block_number will become 0
        // Change state before transfer call
        delete channels[key];
        delete closing_requests[key];

        // Send the unwithdrawn _balance to the receiver
        uint256 receiver_remaining_tokens = _balance - withdrawn_balances[key];
        require(prix_token.transfer(_receiver_address, receiver_remaining_tokens));

        // Send deposit - balance back to sender
        require(prix_token.transfer(_sender_address, channel.deposit - _balance));

        ChannelSettled(
            _sender_address,
            _receiver_address,
            _open_block_number,
            _balance
        );
    }

    /// @notice Sender requests the closing of the channel and starts the challenge period.
    /// This can only happen once.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between
    /// the sender and receiver was created.
    /// @param _balance The amount of tokens owed by the sender to the receiver.
    function uncooperativeClose(
        address _receiver_address,
        uint32 _open_block_number,
        uint256 _balance)
    public
    {
        bytes32 key = getKey(msg.sender, _receiver_address, _open_block_number);

        require(channels[key].open_block_number > 0);
        require(closing_requests[key].settle_block_number == 0);
        require(_balance <= channels[key].deposit);

        // Mark channel as closed
        closing_requests[key].settle_block_number = uint32(block.number) + challenge_period;
        require(closing_requests[key].settle_block_number > block.number);
        closing_requests[key].closing_balance = _balance;
        ChannelCloseRequested(msg.sender, _receiver_address, _open_block_number, _balance);
    }


    /// @notice Function called by the sender after the challenge period has ended, in order to
    /// settle and delete the channel, in case the receiver has not closed the channel himself.
    /// @param _receiver_address The address that receives tokens.
    /// @param _open_block_number The block number at which a channel between
    /// the sender and receiver was created.
    function settle(address _receiver_address, uint32 _open_block_number) public {
        bytes32 key = getKey(msg.sender, _receiver_address, _open_block_number);

        // Make sure an uncooperativeClose has been initiated
        require(closing_requests[key].settle_block_number > 0);

        // Make sure the challenge_period has ended
        require(block.number > closing_requests[key].settle_block_number);

        settleChannel(msg.sender, _receiver_address, _open_block_number,
            closing_requests[key].closing_balance
        );
    }

}

# psc-smart-contract

Privatix Service Contract (PSC)

## Install dependencies
```
npm install -g truffle
npm install -g ganache-cli
npm install -g mocha
npm install -g mocha-junit-reporter
```

## Run tests
```
npm install
npm install zeppelin-solidity@1.4.0
npm run test
```

## Smart contract operations
Ethereum smart contracts playing fundametal role in Privatix DApp architecture. Currently deployed smart contract that holds all PRIX tokens called Privatix Token Contact (hereinafter PTC) and compliant with ERC20 standard.

**PTC will be used for:**

* Token exchange
* Upgrade to new service contract
To provide additional logic and features, as well as support future upgrades, Privatix will deploy additional smart contract named Privatix Service Contract (hereinafter PSC). PSC contract implements state channels features, service offering discovery, helps to negotiate on service setup, incentivize fair usage and controls supply visibility.Token exchange between Ethereum accounts is done using standard ERC20 transfer mechanism. PTC balances will be used to buy and sell PRIX only, rather then pay for services. To use Privatix services PRIX tokens will be approved for transfer to PSC contract address effectively delegating all operations to PSC contract.

**PSC will be used for:**

* Local balance storage
* Agent SO registration and deposit placement
* Agent SO deactivation and deposit return
* Retrieving availabale supply for SO
* Pop up SO
* Creating state channel
* Cooperative close of channel
* Uncooperative close of channel
* Top up deposit of state channel
* State channel perfomance
To save Ethereum gas and decrease time, which is required to setup state channel, PSC will maintain its own balance mapping. This mapping will hold mapping of PRIX to user's balances until user will decide to move PRIX balance back to PTC. For that purpose PSC will have mechanism to return back tokens from PSC to user’s Ethereum address in PTC. Making PSC operations rely on internal balances greatly improves security by preventing external contracts to execute arbitarary code thus mitigating re-enterancy attacks.

## Smart contract upgrade
To support future upgrade of PSC logic and features, while giving users ability to controll and audit such changes, following upgare path is planned. Privatix company may publish new version of PSC (e.g. version 2.0) in future. Users would verify smart contract code and if ageed, that it is safe to use, will firstly transfer thier PRIX tokens from PSC v1.0 back to PTC and only then to PSC v2.0. Such approach leaves no backdoors even for Privatix employees and gives anybody ability to review new smart contract code before they switch to it. Privatix company may implement PSC.upgrade() function, which can be executed only by Privatix company. This function will prevent incoming transactions from PTC to PSC, but will still allow transfer of balances back to PTC. This method can be used as notification of smart contract upgrade to users UI, as well as pushes users to perform upgrade.

## Service supply
Service supply is maximum number of concurrent Clients that Agent can serve with same SO parameters. When Agent registers his offering in PSC he will specify service supply. Publishing service supply will allow Clients to find out, if Agent still has available supply to serve the Client according to published SO. Before state channel is created, PSC will check, if available supply still exists and keep demand and supply balanced. After state channel was created PSC will emit event with actual service supply, making possible for all users to filter out offerings with zero supply. If state channel is closed, service supply will be increased and users notified.

## Sybil attack mitigation
Sybil attck mitigation in decentralized networks, where at least some degree of anonimity expected is not obvious. We are not informed on any bullet proof technology to mitigate sybil attack completely and whithout introducing some enterance threashold. Most used techniques today are proof of work, proof of stake, one time fee, IPv4 address binding.

### Malicious Agent
To maintain network health and incentivize fair usage, we will require Agents to register thier service offering in Ethereum blockchain and place deposit. This deposit can be returned back after some challenge period is passed from last operation with this SO. This step should protect Privatix network from easily being overwhelmed with junk SO and make Sybil attack less efficient. Agent Deposit should be proportional to service supply. If malicious Agent will place useless SO, that he never goes to fullfill, he will be required to place exactly same deposit as Client will place to accept this offer. On the other hand as time passes from service offering registration, Clients will more likely to consider that this SO is nore more actual and will not accept this offer. Agent will need to notify Clients from time to time that his offer is stil alive by poping up it. When Agent pop-ups his SO, deposit will be locked once more for the same challenge period. As pop-up operation makes it cheaper for Agent to spoil service offerings, Clients will make additional considiration before accepting such offer. Long runing SO can be easily rated by comparing number of cooperative channel closes with uncooperative. If Client created state channel, but didn't recieve any service he will be forced to make uncooperative channel close. In that case blockchain event will be emmitted where Agent address is listed. If Client will see that there is too many uncooperative closes compared to cooperative once, he will not create new state channel with this agent. This will require for malicious Agent to create new Agent address, transfer tokens and register new service offering. Such malicious operation is expensive and not effective.

If Agent will try to act both as Agent and Client to increase number of cooperative closes, it will cost him additional transaction fees. Moreover each time he will act as Client he will reduce available supply for his service offering. In this case he need to occupy at least half of maximum supply to make number of cooperative closes equal to number of uncooperative closes. This forces him to place x 1.5 deposit than locked by normal Clients and still his reputation is far from being perfect.

We can summarise that Sybil attack by Agent is limited with Agent token balance, by challenge period and burns Ether with transaction cost.

### Malicious Client
To harm Agent's reputation malicios Client can create state channel and will not send balance proofs to Agent. When creating channel, Client is required to place deposit, which is locked for challenge period. To return deposit back to his balance he need to close the channel. Both operations burns Ether with transaction cost. Agent can also check blockchain event for uncooperative closes of channel made made Client and rate him accordingly. This limits effectiveness of attack.

### Reputation
Both Client and Agent communication results in cooperative or uncooperative channel close. Each time blockhain event is generated wich includes address of Client and Agent, paticipating in channel transaction. These events can be used to make dicisions about user reputation. User can not only count number of coopertive vs uncooperative closes for another user, but go deeper and build reputation based on transactions of obeserved user's partners. For example, if we Agent want to decide on Client's reputation he can see that this Client had good transactions with other Agents and then check those Agent's transactions and see thier transactions, etc.

### Summary
Even these measures still doesn't prevent 100% of sybil attacks, it definitely limits probability and effectiveness of them both for Clients and Agents.

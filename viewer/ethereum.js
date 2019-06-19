const Web3 = require('web3'); // tslint:disable-line


module.exports = class Ethereum {


    constructor(abi, contractAddress, endpoint){
        this.contractAddress = contractAddress;
        const provider = new Web3.providers.WebsocketProvider(endpoint);
        provider.on('error', (e) => console.error('WS Error', e));
        provider.on('end', (err) => {
            console.log('WS End', err);
        });
        this.web3 = new Web3(provider);

        this.contract = new this.web3.eth.Contract(abi, contractAddress);
    }

    onNewBlock(handler){
        const blockWatcher = this.web3.eth.subscribe('newBlockHeaders', function(err, res){
            if(err){
                console.error('coudlnot subscribe to latest blocks',err);
                process.exit(-1);
            }
        });

        blockWatcher.on('data', handler);
    }

    onNewEvent(fromBlock, handler){
        console.log(`Starting event watchers from block ${fromBlock}`);
        this.contract.events.allEvents({fromBlock}, handler)
            .on('data', function(event){
                console.log(event); // same results as the optional callback above
            })
            .on('changed', function(event){
                // remove event from local database
                console.log(event); // same results as the optional callback above
            })
            .on('error', console.error);
    }

    getPastEvents(fromBlock, toBlock){
        console.log(`get past events from ${fromBlock} to ${toBlock}`);
        return new Promise((resolve, reject) => {
              this.contract.getPastEvents('allEvents', {fromBlock, toBlock}, (error, pastEvents) => {
                  if(!error){

                      console.log('INFURA`S RESPONSE LENGTH!!!', JSON.stringify(pastEvents).length);
                      pastEvents = pastEvents.sort(this.sortEvents).map(event => {
                          if(!event.returnValues._receiver){
                              event.returnValues._receiver = '0x0000000000000000000000000000000000000000';
                          }
                          return event;
                      });

                      this.resolveTimeStamps(pastEvents.filter(event => event.address.toLowerCase() === this.contractAddress.toLowerCase()))
                          .then(pastEvents => {
                              resolve(pastEvents);
                          });

                  }else{
                      reject(error);
                  }

              });
        });
    }

    getBalance(account){

        return this.web3.eth.getBalance(account);

    }

    getLastBlockNumber(){
        return this.web3.eth.getBlock('latest')
                   .then(res => res.number);
    }

}

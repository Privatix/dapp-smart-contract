[![Build Status](https://travis-ci.org/Privatix/dapp-smart-contract.svg?branch=master)](https://travis-ci.org/Privatix/dapp-smart-contract)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FPrivatix%2Fdapp-smart-contract.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2FPrivatix%2Fdapp-smart-contract?ref=badge_shield)
[![Maintainability](https://api.codeclimate.com/v1/badges/93d283853c41377f8256/maintainability)](https://codeclimate.com/github/Privatix/dapp-smart-contract/maintainability)

# Smart contracts

Ethereum smart contracts used during offering discovery and payment processing:

- Privatix token contract (PTC) - holds all PRIX tokens, compliant with ERC20 standard.
- Privatix service contract (PSC) - state channels and offering announcement

# Privatix Service Contract (PSC)

PSC contract implements state channels features, service offering discovery, helps to negotiate on service setup, incentivize fair usage and controls supply visibility.

# Documentation

[Smart contracts](https://github.com/Privatix/privatix/blob/develop/doc/smart_contract.md)

# Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

## Prerequisites

Install prerequisite software:
* [npm v5.6+](https://www.npmjs.com/)
* [node.js 9.3+](https://nodejs.org/en/)

## Installation steps

Clone the `dapp-smart-contract` repository using git:

```
git clone https://github.com/Privatix/dapp-smart-contract.git
cd dapp-smart-contract
git checkout master
```

Install dependencies:

```
npm install
```

Install truffle v 4.1.13:

```bash
npm install truffle@4.1.13 -g
```

# Tests

## Running the tests

Install ganache-cli:
```
npm install -g ganache-cli
```

Tests are run using the following command:
```
TARGET=test npm run test
```
Available targets you can see in [targets](targets) directory. 
Setting the environment variable may differ on your system.

# Deploy

Please, use `rinkeby` script to deploy contract to the testnet:

```bash
npm run rinkeby
```

Options:
* `TARGET=<target>`, where `<target>` is `dev` or `stage`:
    ```bash
    TARGET=dev npm run rinkeby
    ```
* `MNEMONIC="<mnemonic phrase>"`, where `<mnemonic phrase>` is 12 word mnemonic 
which addresses are created from.

After deploying, abi files are saved to current directory (root of project).

It's necessary to point out which configuration you want to use. Available configurations are:

* `dev`
* `stage`

You can see them in [targets](targets) directory. 
Of course, you can add your own configuration.

if you already have `Sale` contract deployed you can specify it in the configuration 
(`saleAddress` property). In that case deployed contract will be used instead of 
deploying new one.

Before deploying make sure you have enough funds on wallet (1 eth will be enough). 

You can request ethers for free here:

* [metamask.io](https://faucet.metamask.io/) (make sure you have Metamask extension installed)
* [ropsten.be](http://faucet.ropsten.be:3001/)

## Example of deploy

* [Dev](scripts/deploy_dev.sh):
    ```bash
    ./scripts/deploy_dev.sh
    ```
* [Stage](scripts/deploy_stage.sh):
    ```bash
    ./scripts/deploy_stage.sh
    ```
 
# Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/Privatix/dapp-smart-contract/tags).

## Authors

* [sofabeat](https://github.com/sofabeat)
* [gonzazoid](https://github.com/gonzazoid)
* [lart5](https://github.com/lart5)

See also the list of [contributors](https://github.com/Privatix/dapp-smart-contract/contributors) who participated in this project.


# License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE.txt) file for details.

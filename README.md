# Cross-chain atomic swaps for Bitcoin and Zano

This project was written as an example of atomic swap between Bitcoin and Zano networks, it's based on the code provided in [https://github.com/pinheadmz/swap-test](https://github.com/pinheadmz/swap-test) and the article [https://bcoin.io/guides/swaps.html](https://bcoin.io/guides/swaps.html) 

This is just an example, use at your own risk and keep in mind, that it does actual spend coins.

---

## Install

```
git clone git@github.com:hyle-team/atomic_swap_example.git
cd swap-test
npm install
```

This app has `bcoin` listed as peer dependency.
It is assumed that the user has them already installed globally:

```
npm install -g bcoin
```

...and that the [NODE_PATH](https://nodejs.org/api/modules.html#modules_loading_from_the_global_folders)
environment variable is set.

## Configuration

Example `.conf` files are provided for all four servers (node/wallet, bcoin).
These examples could be copied directly to the default data directories like so:

```
cp conf/bcoin.conf ~/.bcoin/bcoin.conf
cp conf/bcoin-testnet-wallet.conf ~/.bcoin/testnet/wallet.conf
```

The app is hard-coded for `testnet` and specific non-default port numbers so be
sure to configure correctly!

### http ports:
```
bcoin node:   18332 # default for testnet
bcoin wallet: 18334 # default for testnet
```

### Launching nodes

This should work with any type of node (Full, Pruned, or SPV). Once configuration above is complete,
start both nodes:
```
bcoin --spv --daemon
```

To interact with the nodes in this configuration, remember to pass the port number:
```
# to getinfo from bcash node
bcoin-cli --http-port=18032 --api-key=api-key info
```

## Testing

## App

**This is merely a proof-of-concept and should not be used in production without modifications to the security and pirvacy of the protocol. Pull requests are welcome!**

Alice has Bitcoin and wants Zano. Bob has Zano and wants Bitcoin. 
Both parties presented ad two instances of class SwapBundle. 
Before actuall(simulated) deal Alice and Bob negotiated and agreed on conditions, and sharing between each other following information: 
Amount of BTC traded, 
Amount of Zano traded, 
Bob's Bitcoin PublicKey, 
Alice's Bitcoin PublicKey, 
Alice's Zano Address,
TimeLock for BTC, 
Timelock for Zano 




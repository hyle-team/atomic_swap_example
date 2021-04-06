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

It's also assumed that the user has Zano installed and runned locally, and two Zano wallets launched on corresponding ports: [Alice's wallet on port 12335](https://github.com/hyle-team/atomic_swap_example/blob/07549b8158627fb0eb2ee0dd907caa9324b45383/app/run-swap-zano.js#L40) and [Bob's wallet on port 12334](https://github.com/hyle-team/atomic_swap_example/blob/07549b8158627fb0eb2ee0dd907caa9324b45383/app/run-swap-zano.js#L40)
See Zano [repo](https://github.com/hyle-team/zano) for more detailed instructions. Wallet launch should look like that: 

```
# generate new wallet
simplewallet --generate-new-wallet=test2.zan --password=12345

# launch wallet in server mode
simplewallet --wallet-file=test2.zan --password=12345 --rpc-bind-port=12335
```

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
* Alice's Secret hash 
* Amount of BTC traded, 
* Amount of Zano traded, 
* Bob's Bitcoin PublicKey, 
* Alice's Bitcoin PublicKey, 
* Alice's Zano Address,
* TimeLock for BTC, 
* Timelock for Zano 

Typical run of script looks like that: 
```
Secrete.hash: dba33feaed1e37a8e15f12caa122122bb034bbdf246f64f0a4e50578929b440c
[prepare_htlc_watchonly_address] BTC watch-only wallet created:
[prepare_htlc_watchonly_address]: Prepared with BTC P2SH address:
 2NGBpJkpmbPANbRGD4oSNhgkZZJQFpABJ7r
[ALICE]: CREATING HTLC IN BTC NTEWORK FOR BOB....
[createHTLC]: BTC P2SH address:
 2NGBpJkpmbPANbRGD4oSNhgkZZJQFpABJ7r
BTC funding TX sent:
 8745f5364619d73b954319e1d6257e53c843877d05e1b044852a4f948e47edf3
[ALICE]: CREATED, txid:"8745f5364619d73b954319e1d6257e53c843877d05e1b044852a4f948e47edf3"
[BOB]: CHECKING BTC HTLC CONFIRMED....
[check_htlc_proposed]: Detected transaction: 8745f5364619d73b954319e1d6257e53c843877d05e1b044852a4f948e47edf3
[check_htlc_proposed]: Detected funding output: 0
[BOB]: CONFIRMED(8745f5364619d73b954319e1d6257e53c843877d05e1b044852a4f948e47edf3)
[BOB]: CREATING HTLC IN ZANO NTEWORK FOR ALICE.....
[BOB]: CREATED, txid: "0f1c2600ef8656a48db809062a1080f41eb395a33cef66fd56f2e271ff57e357"
[ALICE]: CHECKING ZANO HTLC CONFIRMED....
Sleeping...0
.......
Sleeping...45
[ALICE]: CONFIRMED: txid0f1c2600ef8656a48db809062a1080f41eb395a33cef66fd56f2e271ff57e357
[ALICE]: REDEEM ZANO HTLC...
[ALICE]: REDEEM RESULT: txidb8a8ecf857b9c50b4956bf7fdceeb0917e8404d2818fe7b07a955c7a90c2aaae
[BOB]: CHECK IS ZANO HTLC REDEEMED....
Sleeping...0
......
Sleeping...48
[BOB]: CHECK IS ZANO HTLC REDEEMED. txid: b8a8ecf857b9c50b4956bf7fdceeb0917e8404d2818fe7b07a955c7a90c2aaae
[BOB]: REDEEMING BTC HTLC.....
(node:17068) [DEP0005] DeprecationWarning: Buffer() is deprecated due to security and usability issues. Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
[redeem_htlc] BTC: swap-sweep address:
 mymfyer7a1EWgwZNy4NLo2Wthv48wN5PW3
[redeem_htlc] BTC: swap-sweep TX:
 1e1a670e4369ab08caf0809b9dbe2f6a5bcb07c50e2dd41b01414539de960b4d
BTC broadcasting swepp TX:  {success: true}
[BOB]: DONE
```


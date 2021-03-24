/**
 * swap.js - cross-chain atomic swap manager for the Bitcoin and Zano
 * Copyright (c) 2021, Zano developers (MIT License)
 * https://github.com/hyle-team/zano 
 * 
 * Based on the code provided in https://github.com/pinheadmz/swap-test 
 * and article https://bcoin.io/guides/swaps.html 
 */

 'use strict';

// Requirements
const SwapBTCLowLevel = require('./swap_btc_helper'); 
const {NodeClient, WalletClient} = require('bclient');

 
 /**
  * BTC Swap
  */
 
class SwapEntityBTC {
  constructor() {
    // Load library and set network
    this.btc_lowlevel_swap = new SwapBTCLowLevel('../../bcoin', 'testnet');
  }

  async init(walletID, walletPassphrase, walletAcct)
  {
    this.walletID = walletID;
    this.walletPassphrase = walletPassphrase;
    this.walletAcct = walletAcct;
    this.swapTime =  60 * 60; // 1 hour to swap
    this.cancelTime = 60 * 60 * 24; // 1 day to cancel
    const keys = this.btc_lowlevel_swap.getKeyPair();
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    this.fee = 1000;
  
    // Setup clients
    const ports = {nodePort: 18332, walletPort: 18334};

    this.btcNodeClient = new NodeClient({
      network: 'testnet',
      port: ports.nodePort,
      apiKey: 'api-key'
    });
    
    this.btcWalletClient = new WalletClient({
      network: 'testnet',
      port: ports.walletPort,
      apiKey: 'api-key'
    });
    
    await (async () => {
      this.btcNodeClient.open();
      this.btcWalletClient.open();
    })();
  }

  get_public_key()
  {
    return this.publicKey;
  }

  async send_htlc(counterpartyPublicKey, amount, locktime, hash)
  {
    //////
    // Create P2SH addresses and watch-only wallets for both chains
    const {
      btcRedeemScript,
      btcAddress
    } = await this.createHTLC(hash, locktime, this.publicKey, counterpartyPublicKey);

  
    // TODO: check if funding TX was already sent in a previous run

    // Get primary or user-selected wallet and send to swap P2SH address
    const btcFundingWallet = this.btcWalletClient.wallet(this.walletID);
    const btcFundingTX = await btcFundingWallet.send({
      accout: this.walletAcct,
      passphrase: '',
      outputs: [{ value: amount, address: btcAddress }]
    });
    console.log('BTC funding TX sent:\n', btcFundingTX.hash);
    return {
      'txid': btcFundingTX.hash,
    }
  }

  async prepare_htlc_watchonly_address(hash, locktime, counterpartyPublicKey)
  {
    /*
    console.log('Creating HTLC: \n' +
      'Hash: '+ hash.toString('hex') + '\n' + 
      'btcTimelock: '+ locktime + '\n' + 
      'fromPublicKey: '+ counterpartyPublicKey.toString('hex') + '\n' + 
      'toPublicKey: '+ this.publicKey.toString('hex') + '\n');
      */

      // Create P2SH addresses and watch-only wallet
      const btcRedeemScript = this.btc_lowlevel_swap.getRedeemScript(
        hash,
        counterpartyPublicKey,
        this.publicKey,
        locktime
      ); 
      const btcAddrFromScript = this.btc_lowlevel_swap.getAddressFromRedeemScript(btcRedeemScript);
      this.btcAddress = btcAddrFromScript.toString('testnet');
      //console.log('[prepare_htlc_watchonly_address]: BTC P2SH address:\n', this.btcAddress);
  
      // Get the watch-only wallet to catch counterparty's side of the trade
      const btcWalletName = this.btc_lowlevel_swap.nameWallet(this.btcAddress);
      this.btcWatchWallet = this.btcWalletClient.wallet(btcWalletName);
      let watchWalletInfo = await this.btcWatchWallet.getInfo();
  
      // Create watch-only wallet it doesn't already exist
      if (!watchWalletInfo) {
        console.log('[prepare_htlc_watchonly_address] BTC watch-only wallet created:');
        watchWalletInfo =  await this.btcWalletClient.createWallet(btcWalletName, {watchOnly: true, accountKey: 'tpubDDF921KoqbemP3yPiBMBzvkDY5pe4KpirJtXtSaTdRkZ3LyqorrHy1mv1XLNqrmTQQXztdTQiZxDtPxGZ9Lmiqtv8wJYJs5o52J54djLpqC'});
        // Import address to watch
        await this.btcWatchWallet.importAddress(this.walletAcct, this.btcAddress);
      } 
      else
      {
        //console.log('[check_htlc_proposed] BTC watch-only wallet exists:');
      }
      console.log('[prepare_htlc_watchonly_address]: Prepared with BTC P2SH address:\n', this.btcAddress);
  }

  async check_htlc_proposed()
  {
    const history = await this.btcWatchWallet.getHistory();
    if(history.length === 0)
    {
      return {};
    }else if(history.length !== 1)
    {
      throw console.error('Unexpected number( '+ history.length + ') of htlc trancations for address ' + this.btcAddress);
    }else
    {
      /*
      //In real life this should be uncomented
      if(history[0].height === -1)
      {
        console.log('TX Detected, but unconfirmed yet')
        return {};
      }*/
      console.log('[check_htlc_proposed]: Detected transaction: ' + history[0].hash.toString('hex'));
      //extract output
      const btcFundingTX = this.btc_lowlevel_swap.TX.fromRaw(history[0].tx, 'hex');
      const fundingOutput = this.btc_lowlevel_swap.extractOutput(
        btcFundingTX,
        this.btcAddress
      );
      if (!fundingOutput) 
      {
        throw console.error('Unexpected: instead of funding tx detected sweep(redeem) tx');
      } else {
        console.log('[check_htlc_proposed]: Detected funding output: ' + fundingOutput.index);
        return {
          txid: history[0].hash, 
          fundingOutput: fundingOutput, 
          fundingTx: btcFundingTX,
        };
      }



    }
  }

  async redeem_htlc(btcFundingTX, secret, fundingOutput,  locktime, counterpartyPublicKey)
  {
           // Create P2SH addresses and watch-only wallet
    const btcRedeemScript = this.btc_lowlevel_swap.getRedeemScript(
            this.btc_lowlevel_swap.getSecret(secret).hash,
            counterpartyPublicKey,
            this.publicKey,
            locktime
          );

    // First, get a primary (or user-sepcified) wallet address to receive
    const btcReceivingWallet = this.btcWalletClient.wallet(this.walletID);
    const sweepToAddr = await btcReceivingWallet.createAddress(this.walletAcct);

    // Generate the input script and TX to redeem the HTLC
    const swapScript = this.btc_lowlevel_swap.getSwapInputScript(
      btcRedeemScript,
      secret
    );
    const swapTX = this.btc_lowlevel_swap.getRedeemTX(
      sweepToAddr.address,
      this.fee,
      btcFundingTX,
      fundingOutput.index,
      btcRedeemScript,
      swapScript,
      null,
      this.privateKey
    );

    // Finalize and serialize the transaction
    const finalTX = swapTX.toTX();
    const stringTX = finalTX.toRaw().toString('hex');
    const txId = finalTX.txid();
    console.log('[redeem_htlc] BTC: swap-sweep address:\n', sweepToAddr.address);
    console.log('[redeem_htlc] BTC: swap-sweep TX:\n', swapTX.txid());

    // Broadcast swap-sweep TX, we're done!
    const broadcastResult = await this.btcNodeClient.broadcast(stringTX);
    console.log('BTC broadcasting swepp TX: ', broadcastResult);
    return {txid: txId};
  }

  check_htlc_redeemed(counterpartyPublicKey, locktime)
  {
    let promise = new Promise(async function(resolve, reject) {
    
        // Create P2SH addresses and watch-only wallet
      const btcRedeemScript = this.btc_lowlevel_swap.getRedeemScript(
        hash,          
        this.publicKey,
        counterpartyPublicKey,
        locktime
      );
      const btcAddrFromScript = this.btc_lowlevel_swap.getAddressFromRedeemScript(btcRedeemScript);
      const btcAddress = btcAddrFromScript.toString('testnet');
      console.log('[check_htlc_redeemed]: BTC P2SH address:\n', btcAddress);

      // Get the watch-only wallet to catch counterparty's side of the trade
      const btcWalletName = this.btc_lowlevel_swap.nameWallet(btcAddress);
      const btcWatchWallet = this.btcWalletClient.wallet(btcWalletName);
      let watchWalletInfo = await btcWatchWallet.getInfo();

      // Create watch-only wallet it doesn't already exist
      if (!watchWalletInfo) {
        console.log('[check_htlc_redeemed] BTC watch-only wallet created:');
        watchWalletInfo =  await this.btcWalletClient.createWallet(btcWalletName, {watchOnly: true});
        // Import address to watch
        await btcWatchWallet.importAddress('default', btcAddress);
      } 
      else
      {
        console.log('[check_htlc_redeemed] BTC watch-only wallet exists:');
      }

      // Listen for events
      await this.btcWalletClient.join(btcWalletName, watchWalletInfo.token);
      console.log(' ' + watchWalletInfo.id);

      console.log('[check_htlc_redeemed] Binding for events...');
      // Wait for counterparty TX and sweep it, using our hash's SECRET
      this.btcWalletClient.bind('confirmed', async (wallet, txDetails) => {
        // TODO: check for counterparty refund before revealing secret
        // Get details from counterparty's TX
        const btcSwapTX = this.btc_lowlevel_swap.TX.fromRaw(txDetails.tx, 'hex');
        const revealedSecret = this.btc_lowlevel_swap.extractSecret(
          btcSwapTX,
          btcAddress
        );
        if (!revealedSecret) {
          // If btcSwapTX does not btc the P2SH address in the input,
          // that means the address is in an output, meaning that this TX
          // is our own, funding the swap.
          console.log('[check_htlc_redeemed] BTC funding TX confirmed(Which is not expected here!!!!)');
          console.log('[check_htlc_proposed] Resolve promise with nothing');
          resolve({});
        } else {
          console.log('[check_htlc_redeemed] BTC swap-sweep TX confirmed:\n', txDetails.hash);
          console.log('[check_htlc_redeemed] BTC swap-sweep TX secret revealed:\n',
            revealedSecret
          );
          resolve({
            txid: txDetails.hash,
            secret: revealedSecret
          });
        }
      });
    }.bind(this));

    //console.log('[check_htlc_proposed] Returning promise');
    return promise;
  }

  getSecret(secret)
  {
    return this.btc_lowlevel_swap.getSecret(secret);
  }

  async createHTLC(hash, btcTimelock, fromPublicKey, toPublicKey) {
    // *** btc ***
    // Generate redeem script and P2SH address
    /*
    console.log('Creating HTLC: \n' +
                'Hash: '+ hash.toString('hex') + '\n' + 
                'btcTimelock: '+ btcTimelock + '\n' + 
                'fromPublicKey: '+ fromPublicKey.toString('hex') + '\n' + 
                'toPublicKey: '+ toPublicKey.toString('hex') + '\n' 
    );*/

    const btcRedeemScript = this.btc_lowlevel_swap.getRedeemScript(
      hash,
      fromPublicKey,
      toPublicKey,
      btcTimelock
    );
    const btcAddrFromScript = this.btc_lowlevel_swap.getAddressFromRedeemScript(btcRedeemScript);
    const btcAddress = btcAddrFromScript.toString('testnet');
    console.log('[createHTLC]: BTC P2SH address:\n', btcAddress);
  
    return {
      btcRedeemScript: btcRedeemScript,
      btcAddress: btcAddress
    };
  };
}

module.exports = SwapEntityBTC;
 
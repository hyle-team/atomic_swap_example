/**
 * Run cross-chain atomic swap.
 * WARNING: Running this script will send transactions and spend coins!
 */

'use strict';


console.log('Starting, loading libraries...');


// Requirements
const {NodeClient, WalletClient} = require('bclient');
const {base58} = require('bstring');
const Config = require('bcfg');
const Swap = require('../lib/swap');
const Xrate = require('../lib/xrate');


console.log('Loaded');


// Load command line arguments
const config = new Config('bswap'); // module name required but it's ignored
config.load({argv: true});

// Required arguments
const mine = config.str('mine');
const theirs = config.str('theirs');
const btc = config.str('btc');
const bch = config.str('bch');
const mode = config.str('mode');
const amount = config.uint('amount');
const passphrase = config.str('passphrase', '');

// Optional arguments with defaults
const walletAcct = config.str('account', 'default');
const walletID = config.str('wallet', 'primary');
const swapTime = config.uint('swap-time', 60 * 60); // 1 hour to swap
const cancelTime = config.uint('cancel-time', 60 * 60 * 24); // 1 day to cancel
const fee = config.uint('fee', 1000);
const network = config.str('network', 'testnet');
const refund = config.bool('refund', false);
const tolerance = config.float('tolerance', 0.05); // tolerance on exchange rate

// Quick usage check
if (!mine || !theirs || !btc || !bch || !mode || !amount)
  err(
    'Usage:\n' +
    '  node run-swap.js --mine=<prep-swap PRIVATE output> \\ \n' +
    '  --theirs=<prep-swap PUBLIC from counterparty> \\ \n' +
    '  --btc=<bcoin|bcash> --bch=<bcoin|bcash> \\ \n' +
    '  --mode=<swap|sweep>  --amount=<in satoshis>\\ \n' +
    ' (optional, more in README.md): \n' +
    '  --refund=true --passphrase=<btc-coin wallet PASSPHRASE>');

// Convert base58 strings back into JSON objects
const myObject = JSON.parse(base58.decode(mine));
const theirObject = JSON.parse(base58.decode(theirs));

// Check all the parameters in the base58-encoded JSON objects
if (typeof myObject.privateKey !== 'string'
    || typeof myObject.secret !== 'string') {
  err ('Bad mine');
}

if (myObject.privateKey.length !== 64)
  err ('Bad mine: privateKey size');

if (myObject.secret.length !== 64)
  err ('Bad mine: secret size');

if (typeof theirObject.publicKey !== 'string'
    || typeof theirObject.hash !== 'string') {
  err ('Bad theirs');
}

if (theirObject.publicKey.length !== 66)
  err ('Bad theirs: publicKey size');

if (theirObject.hash.length !== 64)
  err ('Bad theirs: hash size');

const supportedLibs = ['bcoin', 'bcash'];
if (supportedLibs.indexOf(btc) === -1
    || supportedLibs.indexOf(bch) === -1
    || btc === bch) {
  err('Bad btc / bch: must be different, "bcoin" or "bcash"');
}

const supportedModes = ['start', 'swap'];
if (supportedModes.indexOf(mode) === -1) {
  err('Bad mode: must be "start" or "swap"');
}

// Load blockchain libraries
//const btcSwap = new Swap(btc, network);
const btcSwap = new Swap('../../bcoin', network);
const bchSwap = new SwapZano(bch, network);

// Derive the necessary public strings from private key and secret
// Using the "btc" library here but it could be either for this step
myObject.publicKey = btcSwap.getKeyPair(myObject.privateKey).publicKey;
myObject.hash = btcSwap.getSecret(myObject.secret).hash;

// Setup clients
const ports = {
  bcoin: {nodePort: 18332, walletPort: 18334},
  //bcash: {nodePort: 18032, walletPort: 18034}
};

const btcClient = new NodeClient({
  network: network,
  port: ports[btc].nodePort,
  apiKey: 'api-key'
});

const btcWallet = new WalletClient({
  network: network,
  port: ports[btc].walletPort,
  apiKey: 'api-key'
});

const bchClient = new NodeClient({
  network: network,
  port: ports[bch].nodePort,
  apiKey: 'api-key'
});

const bchWallet = new WalletClient({
  network: network,
  port: ports[bch].walletPort,
  apiKey: 'api-key'
});

// Open wallet and node sockets
(async () => {
  bchWallet.open();
  btcWallet.open();
  bchClient.open();
  btcClient.open();
})();

switch (mode) {
  // ** START ** Initiate the swap by funding the HTLC address on "btc" chain
  case 'start': {
    (async () => {
      // Create P2SH addresses and watch-only wallets for both chains
      const {
        btcRedeemScript,
        bchRedeemScript,
        bchAddress,
        btcAddress,
        btcWatchWallet
      } = await createHTLC(myObject.hash, cancelTime, swapTime);

      // Refund path
      if (refund) {
        await getRefund(
          btcAddress,
          btcRedeemScript,
          btcWatchWallet,
          cancelTime
        );
        return;
      }

      // TODO: check if funding TX was already sent in a previous run
      // Get primary or user-selected wallet and send to swap P2SH address
      const btcFundingWallet = btcWallet.wallet(walletID);
      const btcFundingTX = await btcFundingWallet.send({
        accout: walletAcct,
        passphrase: passphrase,
        outputs: [{ value: amount, address: btcAddress }]
      });
      console.log(btc + ' funding TX sent:\n', btcFundingTX.hash);
      console.log('...with HTLC secret:\n', myObject.secret);

      //HERE WE WAIT FOR COUNTERPARTY

      // Wait for counterparty TX and sweep it, using our hash's SECRET
      bchWallet.bind('confirmed', async (wallet, txDetails) => {
        // TODO: check for counterparty refund before revealing secret
        // Get details from counterparty's TX
        const bchFundingTX = bchSwap.TX.fromRaw(txDetails.tx, 'hex');
        const fundingOutput = bchSwap.extractOutput(
          bchFundingTX,
          bchAddress
        );
        if (!fundingOutput) {
          // If bchFundingTX doesn't btc the P2SH address as an output,
          // that means it has the address in its input, meaning this TX
          // is actually our own, sweeping the coin
          console.log(bch + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(bch + ' funding TX confirmed:\n', txDetails.hash);
          console.log(bch + ' funding TX output:\n', fundingOutput);
        }

        // Check counterparty's sent amount against our amount and exchange rate
        const xrate = new Xrate({
          btc: btc,
          bch: bch,
          receivedAmount: fundingOutput.amount
        });
        const swapAmt = await xrate.getSwapAmt();
        const xRateErr = Math.abs(amount - swapAmt) / amount;
        if (tolerance < xRateErr) {
          console.log(
            'Counterparty sent wrong amount.\n' +
            'Waiting for new tx (or ctrl+c and --refund to cancel)'
          );
          return;
        }

        // Create a TX on "bch" chain to sweep counterparty's output
        // First, get a primary (or user-sepcified) wallet address to receive
        const bchReceivingWallet = bchWallet.wallet(walletID);
        const sweepToAddr =
          await bchReceivingWallet.createAddress(walletAcct);

        // Generate the input script and TX to redeem the HTLC
        const swapScript = bchSwap.getSwapInputScript(
          bchRedeemScript,
          myObject.secret
        );
        const swapTX = bchSwap.getRedeemTX(
          sweepToAddr.address,
          fee,
          bchFundingTX,
          fundingOutput.index,
          bchRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );

        // Finalize and serialize the transaction
        const finalTX = swapTX.toTX();
        const stringTX = finalTX.toRaw().toString('hex');
        console.log(bch + ' swap-sweep address:\n', sweepToAddr.address);
        console.log(bch + ' swap-sweep TX:\n', swapTX.txid());

        // Broadcast swap-sweep TX, we're done!
        const broadcastResult = await bchClient.broadcast(stringTX);
        console.log(bch + ' broadcasting swap TX: ', broadcastResult);
        process.exit();
      });

      // Just in case we're "late" check last 100 blocks
      console.log(btc + ' checking last 100 blocks for transactions');
      await rescan100(btcClient, btcWallet);
      console.log(bch + ' checking last 100 blocks for transactions');
      await rescan100(bchClient, bchWallet);
    })();
    break;
  }

  // ** SWAP ** Accept swap by posting TX with HTLC and wait for secret
  case 'swap': {
    (async () => {
      // Create P2SH addresses and watch-only wallets for both chains
      const {
        bchRedeemScript,
        btcRedeemScript,
        bchAddress,
        btcAddress,
        btcWatchWallet
      } = await createHTLC(theirObject.hash, swapTime, cancelTime);

      // Refund path
      if (refund) {
        await getRefund(
          btcAddress,
          btcRedeemScript,
          btcWatchWallet,
          swapTime
        );
        return;
      }

      // This mode requires two wallet event listeners, so we need to
      // initialize these variables in a braoder scope
      let startTX = null;
      let startTXoutput = null;

      // Wait for counterparty TX before posting our own
      bchWallet.bind('confirmed', async (wallet, txDetails) => {
        // TODO: check for counterparty refund before sending anything
        // Get details from counterparty's TX
        startTX = bchSwap.TX.fromRaw(txDetails.tx, 'hex');
        startTXoutput = bchSwap.extractOutput(
          startTX,
          bchAddress
        );
        if (!startTXoutput) {
          // If startTX doesn't btc the P2SH address in an output,
          // that means the address is in the input, meaning this TX
          // us actually our own, sweeping the coin
          console.log(bch + ' swap-sweep TX confirmed');
          return;
        } else {
          console.log(bch + ' funding TX confirmed:\n', txDetails.hash);
          console.log(bch + ' funding TX output:\n', startTXoutput);
        }

        // Check counterparty's sent amount against our amount and exchange rate
        const xrate = new Xrate({
          btc: btc,
          bch: bch,
          receivedAmount: startTXoutput.amount
        });
        const swapAmt = await xrate.getSwapAmt();
        const xRateErr = Math.abs(amount - swapAmt) / amount;
        if (tolerance < xRateErr) {
          console.log(
            'Counterparty sent wrong amount.\n' +
            'Waiting for new tx (or ctrl+c and --refund)'
          );
          return;
        }

        // Get primary or user-selected wallet and send to swap P2SH address
        const btcFundingWallet = btcWallet.wallet(walletID);
        const btcFundingTX = await btcFundingWallet.send({
          passphrase: passphrase,
          outputs: [{ value: amount, address: btcAddress }]
        });
        console.log(btc + ' funding TX sent:\n', btcFundingTX.hash);
      });

      // Watch our own "btc" TX and wait for counterparty to sweep it
      btcWallet.bind('confirmed', async (wallet, txDetails) => {
        // Get details from counterparty's TX
        const btcSwapTX = btcSwap.TX.fromRaw(txDetails.tx, 'hex');
        const revealedSecret = btcSwap.extractSecret(
          btcSwapTX,
          btcAddress
        );
        if (!revealedSecret) {
          // If btcSwapTX does not btc the P2SH address in the input,
          // that means the address is in an output, meaning that this TX
          // is our own, funding the swap.
          console.log(btc + ' funding TX confirmed');
          return;
        } else {
          console.log(btc + ' swap-sweep TX confirmed:\n', txDetails.hash);
          console.log(
            btc + ' swap-sweep TX secret revealed:\n',
            revealedSecret
          );
        }

        // Create a TX on "bch" chain to sweep counterparty's output
        // First, get a primary (or user-sepcified) wallet address to receive
        const bchReceivingWallet = bchWallet.wallet(walletID);
        const sweepToAddr =
          await bchReceivingWallet.createAddress(walletAcct);

        // Generate the input script and TX to redeem the HTLC
        const swapScript = bchSwap.getSwapInputScript(
          bchRedeemScript,
          revealedSecret
        );
        const swapTX = bchSwap.getRedeemTX(
          sweepToAddr.address,
          fee,
          startTX,
          startTXoutput.index,
          bchRedeemScript,
          swapScript,
          null,
          myObject.privateKey
        );

        // Finalize and serialize the transaction
        const finalTX = swapTX.toTX();
        const stringTX = finalTX.toRaw().toString('hex');
        console.log(bch + ' swap-sweep address:\n', sweepToAddr.address);
        console.log(bch + ' swap-sweep TX:\n', swapTX.txid());

        // Broadcast swap-sweep TX, we're done!
        const broadcastResult = await bchClient.broadcast(stringTX);
        console.log(bch + ' broadcasting swap TX: ', broadcastResult);
        process.exit();
      });

      // Just in case we're "late" check last 100 blocks
      console.log(btc + ' checking last 100 blocks for transactions');
      await rescan100(btcClient, btcWallet);
      console.log(bch + ' checking last 100 blocks for transactions');
      await rescan100(bchClient, bchWallet);
    })();
    break;
  }
}

/**
 * Common function for both modes
 * Creates HTLC scripts, derives P2SH addresses
 * and creates watch-only wallets for both chains
 */

async function createHTLC(hash, btcTimelock, bchTimelock) {
  // *** btc ***
  // Generate redeem script and P2SH address
  const btcRedeemScript = btcSwap.getRedeemScript(
    hash,
    myObject.publicKey,
    theirObject.publicKey,
    btcTimelock
  );
  const btcAddrFromScript =
    btcSwap.getAddressFromRedeemScript(btcRedeemScript);
  const btcAddress = btcAddrFromScript.toString(network);
  console.log(btc + ' P2SH address:\n', btcAddress);

  // Get the watch-only wallet in case we need to self-refund
  const btcWalletName = btcSwap.nameWallet(btcAddress);
  const btcWatchWallet = btcWallet.wallet(btcWalletName);
  let btcWalletInfo = await btcWatchWallet.getInfo();

  // Create watch-only wallet if doesn't already exist
  if (!btcWalletInfo) {
    console.log(btc + ' watch-only wallet created:');
    btcWalletInfo =
      await btcWallet.createWallet(btcWalletName, {watchOnly: true});
    // Import address to watch
    await btcWatchWallet.importAddress('default', btcAddress);
  } else {
    console.log(btc + ' watch-only wallet exists:');
  }

  // Listen for events
  await btcWallet.join(btcWalletName, btcWalletInfo.token);
  console.log(' ' + btcWalletInfo.id);

  // *** bch ***
  // Generate redeem script and P2SH address
  const bchRedeemScript = bchSwap.getRedeemScript(
    hash,
    theirObject.publicKey,
    myObject.publicKey,
    bchTimelock
  );
  const bchAddrFromScript =
    bchSwap.getAddressFromRedeemScript(bchRedeemScript);
  const bchAddress = bchAddrFromScript.toString(network);
  console.log(bch + ' P2SH address:\n', bchAddress);

  // Get the watch-only wallet to catch counterparty's side of the trade
  const bchWalletName = bchSwap.nameWallet(bchAddress);
  const bchWatchWallet = bchWallet.wallet(bchWalletName);
  let watchWalletInfo = await bchWatchWallet.getInfo();

  // Create watch-only wallet it doesn't already exist
  if (!watchWalletInfo) {
    console.log(bch + ' watch-only wallet created:');
    watchWalletInfo =
      await bchWallet.createWallet(bchWalletName, {watchOnly: true});
    // Import address to watch
    await bchWatchWallet.importAddress('default', bchAddress);
  } else {
    console.log(bch + ' watch-only wallet exists:');
  }

  // Listen for events
  await bchWallet.join(bchWalletName, watchWalletInfo.token);
  console.log(' ' + watchWalletInfo.id);

  // Send back the addresses, used by the modes differently
  return {
    bchRedeemScript: bchRedeemScript,
    btcRedeemScript: btcRedeemScript,
    bchAddress: bchAddress,
    btcAddress: btcAddress,
    btcWatchWallet: btcWatchWallet
  };
};

/**
 * Common function for both modes
 * Creates input script and transaction to refund from the HTLC
 * Checks network mean time for every new block until time lock
 * is expired, then broadcasts the refund TX
 */

async function getRefund(
  btcAddress,
  btcRedeemScript,
  btcWatchWallet,
  locktime
) {
  // Get all transactions paying to our P2SH address
  const txs = await btcWatchWallet.getHistory('default');
  let found = false;
  // TODO: sweep wallet with one big tx instead of one refund at a time
  for (const tx of txs) {
    const fundingTX = btcSwap.TX.fromRaw(tx.tx, 'hex');

    // Check if the tx is a send or receive from the P2SH address
    // We can only refund the coins sent TO the address
    const {index} = btcSwap.extractOutput(fundingTX, btcAddress);
    if (index === false)
      continue;
    found = true;

    // Get the network mean time at which the TX was confirmed
    const confBlock = tx.block;
    if (confBlock < 1)
      err('Funding TX not yet confirmed');
    const confBlockHeader =
      await btcClient.execute('getblockheader', [confBlock, 1]);
    const confTime = confBlockHeader.mediantime;
    const minRedeemTime = confTime + locktime;

    // Get a receiving address from primary wallet to sweep funds to
    const btcReceivingWallet = btcWallet.wallet(walletID);
    const sweepToAddr =
      await btcReceivingWallet.createAddress(walletAcct);

    // Generate input script and TX to redeem the refund from the HTLC
    const btcRefundScript = btcSwap.getRefundInputScript(btcRedeemScript);
    const refundTX = btcSwap.getRedeemTX(
      sweepToAddr.address,
      fee,
      fundingTX,
      index,
      btcRedeemScript,
      btcRefundScript,
      locktime,
      myObject.privateKey
    );

    // Finalize and serialize the transaction
    const finalTX = refundTX.toTX();
    const stringTX = finalTX.toRaw().toString('hex');
    console.log(btc + ' refund TX:\n', finalTX.txid());

    // Get the current network mean time from the latest block
    const tipHash = await btcClient.execute('getbestblockhash');
    const tipHeader =
      await btcClient.execute('getblockheader', [tipHash, 1]);
    const tipMTP = tipHeader.mediantime;

    // Check if time lock has already expired, if so: broadcast and we're done
    if (tipMTP >= minRedeemTime) {
      const tipBroadcastResult = await btcClient.broadcast(stringTX);
      console.log('Timelock expired, broadcasting TX:\n', tipBroadcastResult);
      process.exit();
    }

    // Wait for network time to expire
    console.log(
      'Waiting for locktime to expire: ',
      btcSwap.util.date(minRedeemTime)
    );

    // Check every block for updated network mean time
    btcClient.bind('chain connect', async (block) => {
      const blockEntry = btcSwap.ChainEntry.fromRaw(block);
      const blockHash = blockEntry.rhash();
      const blockHeader =
        await btcClient.execute('getblockheader', [blockHash, 1]);
      const mtp = blockHeader.mediantime;

      // If time lock has expired, broadcast the refund TX and we're done
      if (mtp >= minRedeemTime) {
        const broadcastResult = await btcClient.broadcast(stringTX);
        console.log('Timelock expired, broadcasting TX:\n', broadcastResult);
        process.exit();
      } else {
        console.log(
          'Block received, but timelock not expired. Current time: ',
          btcSwap.util.date(mtp)
        );
      }
    });
  }
  if (!found)
    err('No refundable tx found');
}

/**
 * Determine if node is full/pruned or SPV
 */

async function isSPV(nodeClient) {
  try {
    await nodeClient.getBlock(0);
  } catch (e) {
    return true;
  }
  return false;
}

/**
 * Rescan last 100 blocks on full/prune node, or reset if SPV
 */

async function rescan100(nodeClient, walletClient) {
  const spv = await isSPV(nodeClient);
  const info = await nodeClient.getInfo();
  const height = info.chain.height - 100;

  // rescan won't work by itself in SPV mode
  if (spv) {
    await nodeClient.reset(height);
  } else {
    await walletClient.rescan(height);
  }
}

/**
 * Utility for clean error output
 */

function err(msg) {
  console.log(msg);
  process.exit();
}

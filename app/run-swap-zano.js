/**
 * Run cross-chain atomic swap.
 * WARNING: Running this script will send transactions and spend coins!
 */

 'use strict';

 
 // Requirements
 const {base58} = require('bstring');
 const SwapEntityZano = require('../lib/swap_zano');
 const SwapEntityBTC = require('../lib/swap_btc');


class SwapBundle{
  constructor() {
    this.btc = new SwapEntityBTC();
    this.zano = new SwapEntityZano();
  }
}

function sleep(ms) 
{
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function perform_swap()
{
  const partyAlice = new SwapBundle();
  const partyBob = new SwapBundle();

  await partyAlice.btc.init('primary', "", 'default');
  await partyBob.btc.init('wallet_2', "12345", 'default');

  await partyAlice.zano.init(12335); //Alice's zano wallet instance running on port 12335
  await partyBob.zano.init(12334); //Bob's's zano wallet instance running on port 12334
  

  //temporary code(remove it when it's working)
  //partyAlice.btc.privateKey = new Buffer('eae90b84dff2413385ad18133f77230cbabe863aedf71394e91e115126661000', 'hex');
  //partyBob.btc.privateKey = new Buffer('1b2ccf43d007f87e489765451bc47dc40db50c7780e98ce20cb8f7694ed8cbaf', 'hex');
  //partyAlice.btc.publicKey = partyAlice.btc.btc_lowlevel_swap.getKeyPair(partyAlice.btc.privateKey).publicKey;
  //partyBob.btc.publicKey = partyBob.btc.btc_lowlevel_swap.getKeyPair(partyBob.btc.privateKey).publicKey;

  const amount_btc = 1000;
  const amount_zano = 1000000000000;
  const swap_time_btc = 60*60*2;  //seconds, 2 hour for swap
  const swap_time_zano = 60; //blocks, 1 block per minutes, 1 hour

  //Generate a secrete for Aclice 
  const alice_secret = partyAlice.btc.getSecret();
  //const alice_secret = partyAlice.btc.getSecret('c4c830491b74a28cb3e287b96e348846ce677e483e986f8340f32a872c29e18c');

  //console.log('Alice secret key: ' + partyAlice.btc.privateKey.toString('hex'));
  //console.log('Alice public key: ' + partyAlice.btc.publicKey.toString('hex'));
  //console.log('Bob secret key: ' + partyBob.btc.privateKey.toString('hex'));
  //console.log('Bob public key: ' + partyBob.btc.publicKey.toString('hex'));
  
  //const tmp = await partyAlice.btc.get_public_key();
  
  //console.log("Secrete: " + alice_secret.secret.toString('hex'));
  console.log("Secrete.hash: " + alice_secret.hash.toString('hex'));

  //Preparation step:
  //needed to make Bob's watch only wallet already initiated to catch next step transaction "on the fly"
  await partyBob.btc.prepare_htlc_watchonly_address(alice_secret.hash, swap_time_btc, partyAlice.btc.get_public_key()); 
  
  console.log("[ALICE]: CREATING HTLC IN BTC NTEWORK FOR BOB....");
  const res_alice_sent_htlc = await partyAlice.btc.send_htlc(partyBob.btc.get_public_key(), amount_btc, swap_time_btc, alice_secret.hash);
  console.log("[ALICE]: CREATED, txid:" + JSON.stringify(res_alice_sent_htlc.txid));
  

  console.log("[BOB]: CHECKING BTC HTLC CONFIRMED....");
  var sleep_count = 0;
  let check_res = undefined;
  while(true)
  {
    check_res = await partyBob.btc.check_htlc_proposed(); 
    if(check_res !== undefined && check_res.txid !== undefined)
    {
      break;
    } 
    
    console.log("Sleeping..." + sleep_count);
    sleep_count += 1;
    await sleep(1000);
  }
  console.log("[BOB]: CONFIRMED(" + check_res.txid.toString('hex') + ")");
  // ------ SKIP ------  
  // Bob make sure amount corresponds to agreed 
  // ------------------  
  console.log("[BOB]: CREATING HTLC IN ZANO NTEWORK FOR ALICE.....");
  const bob_send_htlc_res = await partyBob.zano.send_htlc(await partyAlice.zano.get_address(), amount_zano, swap_time_zano, alice_secret.hash);
  console.log("[BOB]: CREATED, txid: " + JSON.stringify(bob_send_htlc_res.result.result_tx_id));
  //comment this: 
  //const bob_send_htlc_res = {txid: 'a78178e6933fcf58f784f39bd9866933aaa2550c31ccaacb2cac513b61aa1ae4'}; 
  

  console.log("[ALICE]: CHECKING ZANO HTLC CONFIRMED....");
  let alice_check_res = undefined;
  sleep_count = 0;
  while(true)
  {
    alice_check_res = await partyAlice.zano.check_htlc_proposed(await partyBob.zano.get_address(), alice_secret.hash); 
    if(alice_check_res !== undefined && alice_check_res.found !== undefined && alice_check_res.found === true)
    {
      break;
    } 
    
    console.log("Sleeping..." + sleep_count);
    sleep_count += 1;
    await sleep(1000);
  }
  console.log("[ALICE]: CONFIRMED: txid" + alice_check_res.info.tx_id);
  
  // ------ SKIP ------  
  // Alice make sure amount corresponds to agreed 
  // ------------------  
  
  console.log("[ALICE]: REDEEM ZANO HTLC...");
  const alice_redeem_res = await partyAlice.zano.redeem_htlc(alice_check_res.info.tx_id, alice_secret.secret);
  console.log("[ALICE]: REDEEM RESULT: txid" + alice_redeem_res.result.result_tx_id);
  

  console.log("[BOB]: CHECK IS ZANO HTLC REDEEMED....");
  let bob_check_redeemed_res = undefined;
  sleep_count = 0;
  while(true)
  {
    bob_check_redeemed_res = await partyBob.zano.check_htlc_redeemed(bob_send_htlc_res.result.result_tx_id); 
    if(bob_check_redeemed_res.result !== undefined 
       && bob_check_redeemed_res.result.origin_secrete_as_hex !== undefined
       && bob_check_redeemed_res.result.origin_secrete_as_hex !== ''
       )
    {
      break;
    }

    console.log("Sleeping..." + sleep_count);
    sleep_count += 1;
    await sleep(1000);
  }
  console.log("[BOB]: CHECK IS ZANO HTLC REDEEMED. txid: " + bob_check_redeemed_res.result.redeem_tx_id);

  //TODO: COMMENT IT
  //const bob_check_redeemed_res = {result:{origin_secrete_as_hex: 'c4c830491b74a28cb3e287b96e348846ce677e483e986f8340f32a872c29e17c'}};


  console.log("[BOB]: REDEEMING BTC HTLC.....");
  const bob_redeem_res = await partyBob.btc.redeem_htlc(check_res.fundingTx, bob_check_redeemed_res.result.origin_secrete_as_hex, check_res.fundingOutput, swap_time_btc, partyAlice.btc.get_public_key());
  if(bob_redeem_res.txid === undefined)
  {
    console.log("[BOB]: ERROR");  
    process.exit(0);
  }  
  console.log("[BOB]: DONE");
  
  process.exit(1);
}

perform_swap();
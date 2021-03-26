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

  const amount_btc = 1000;
  const amount_zano = 1000000000000;
  const swap_time_btc = 60*60*2;  //seconds, 2 hour for swap
  const swap_time_zano = 60; //blocks, 1 block per minutes, 1 hour

  //Generate a secrete for Aclice 
  const alice_secret = partyAlice.btc.getSecret();

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

  console.log("[BOB]: REDEEMING BTC HTLC.....");
  const bob_redeem_res = await partyBob.btc.redeem_htlc(check_res.fundingTx, bob_check_redeemed_res.result.origin_secrete_as_hex, check_res.fundingOutput, swap_time_btc, partyAlice.btc.get_public_key());
  if(bob_redeem_res.txid === undefined)
  {
    console.log("[BOB]: ERROR");  
    process.exit(0);
  }  
  console.log("[BOB]: DONE");
  
  console.log("SWAP SUCCESSFULLY DONE");

  process.exit(1);
}

async function perform_swap_zano_first()
{
  const partyAlice = new SwapBundle();
  const partyBob = new SwapBundle();

  await partyAlice.btc.init('primary', "", 'default');
  await partyBob.btc.init('wallet_2', "12345", 'default');

  await partyAlice.zano.init(12335); //Alice's zano wallet instance running on port 12335
  await partyBob.zano.init(12334); //Bob's's zano wallet instance running on port 12334

  const amount_btc = 1000;
  const amount_zano = 1000000000000;
  const swap_time_btc = 60*60*2;  //seconds, 2 hour for swap
  const swap_time_zano = 60; //blocks, 1 block per minutes, 1 hour

  //in this scenario we don't need to generate secrete as a separate step, 
  //Zano walet will generate this secret automatically in a deterministic way
  console.log("[BOB]: CREATING HTLC IN ZANO NTEWORK FOR ALICE.....");
  const bob_send_htlc_res = await partyBob.zano.send_htlc(await partyAlice.zano.get_address(), amount_zano, swap_time_zano, "0000000000000000000000000000000000000000000000000000000000000000");
  console.log("[BOB]: CREATED, \n"
        + "txid: " + bob_send_htlc_res.result.result_tx_id + "\n"
        + "generated_origin(secret): " + bob_send_htlc_res.result.derived_origin_secret_as_hex
        );
  
  console.log("[ALICE]: CHECKING ZANO HTLC CONFIRMED....");
  let alice_check_res = undefined;
  sleep_count = 0;
  while(true)
  {
    alice_check_res = await partyAlice.zano.check_htlc_proposed(await partyBob.zano.get_address()); 
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

    //Preparation step:
  //needed to make Bob's watch only wallet already initiated to catch next step transaction "on the fly"
  await partyBob.btc.prepare_htlc_watchonly_address(alice_check_res.info.sha256_hash, swap_time_btc, partyAlice.btc.get_public_key()); 


  console.log("[ALICE]: CREATING HTLC IN BTC NTEWORK FOR BOB....");
  const res_alice_sent_htlc = await partyAlice.btc.send_htlc(partyBob.btc.get_public_key(), amount_btc, swap_time_btc, alice_check_res.info.sha256_hash);
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

    //Preparation step:
  //needed to make Alices watch only wallet already initiated to catch next step transaction "on the fly"
  await partyAlice.btc.prepare_htlc_watchonly_address(alice_check_res.info.sha256_hash, swap_time_btc, partyBob.btc.get_public_key(), true); 


  console.log("[BOB]: REDEEMING BTC HTLC.....");
  const bob_redeem_res = await partyBob.btc.redeem_htlc(check_res.fundingTx, bob_send_htlc_res.result.derived_origin_secret_as_hex, check_res.fundingOutput, swap_time_btc, partyAlice.btc.get_public_key());
  if(bob_redeem_res.txid === undefined)
  {
    console.log("[BOB]: ERROR");  
    process.exit(0);
  }
  console.log("[BOB]: REDEEMED OK, txid: " + bob_redeem_res.txid);


  console.log("[ALICE]: CHECKING BTC HTLC REDEEMED....");
  sleep_count = 0;
  check_res = undefined;
  while(true)
  {
    check_res = await partyAlice.btc.check_htlc_redeemed();
    if(check_res !== undefined && check_res.txid !== undefined)
    {
      break;
    } 
    
    console.log("Sleeping..." + sleep_count);
    sleep_count += 1;
    await sleep(10000);
  }
  console.log("[Alice]: HTLC REDEEMED(" + check_res.txid.toString('hex') + ", secrete: " + check_res.secret.toString('hex') + ")");
  
  console.log("[ALICE]: REDEEM ZANO HTLC...");
  const alice_redeem_res = await partyAlice.zano.redeem_htlc(alice_check_res.info.tx_id, check_res.secret);
  console.log("[ALICE]: REDEEM RESULT: txid" + alice_redeem_res.result.result_tx_id);

  console.log("SWAP SUCCESSFULLY DONE");
  
  process.exit(1);
}


perform_swap_zano_first();
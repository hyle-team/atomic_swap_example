/**
 * swap.js - cross-chain atomic swap manager for the Bitcoin and Zano
 * Copyright (c) 2021, Zano developers (MIT License)
 * https://github.com/hyle-team/zano 
 * 
 * Based on the code provided in https://github.com/pinheadmz/swap-test 
 * and article https://bcoin.io/guides/swaps.html 
 */


 'use strict';

 //const bcrypto = require('bcrypto');
 const request = require('request');
 const dim = require('../lib/colors');
 /**
  * Swap
  */
 
class ZanoRPCHelper
{  
  constructor(port) 
  {
    this.port = port;
  }

  init(port)
  {
    this.port = port;
  }

  async invoke(method, params)
  {
    let promise = new Promise(function(resolve, reject) 
    {
      const url_str = "http://localhost:"+this.port.toString() + "/json_rpc";
      let options = {
        url: url_str,
        method: "get",
        headers:
        { 
         "content-type": "text/json"
        },
        body: JSON.stringify( 
          {
            jsonrpc: "1.0",
            id: 0,
            method: method,
            params: params
          })
        };
        //console.log(dim('ZANO RPC[' + method + ']: --> \n' + JSON.stringify(params))); 
      
      request(options, (error, response, body) => 
      {
          if (error) 
          {
              console.error('[invoke] An error has occurred: ', error);
              reject({});
          } else 
          {
              //console.log('[invoke] OK');              
              const parsed_response = JSON.parse(body);
              //console.log(dim('ZANO RPC[' + method + ']: <-- \n' + JSON.stringify(parsed_response)));  
              resolve(parsed_response);
          }
      });
    }.bind(this));

    return promise;
  }
}




class SwapEntityZano 
{
  constructor() 
  {
    this.rpc_helper = new ZanoRPCHelper(0);    
  }

  init(port)
  {
    this.rpc_helper.init(port);
  }

  async get_address()
  {
    const res = await this.rpc_helper.invoke("getaddress", {}); 
    return res.result.address;
  }


  async send_htlc(counterparty_address, amount, locktime, hash)
  {
    console.log();
    const res = await this.rpc_helper.invoke("atomics_create_htlc_proposal", 
    {
      amount: amount, 
      counterparty_address: counterparty_address,
      lock_blocks_count: locktime, 
      htlc_hash: hash.toString('hex')
    }); 
    return res;
  }

  async check_htlc_proposed(conterparty_address, hash)
  {
    var hash_str = undefined;
    if(hash !== undefined)
    {
      hash_str = hash.toString('hex');
    }
    
    const res = await this.rpc_helper.invoke("atomics_get_list_of_active_htlc", 
    {
      income_redeem_only: true, 
    });
    if(res.result !== undefined && res.result.htlcs !== undefined)
    {
      //check in the list if address match
      for (var i = 0; i < res.result.htlcs.length; i++) 
      {
        if(res.result.htlcs[i].counterparty_address === conterparty_address 
          && (hash_str === undefined || res.result.htlcs[i].sha256_hash === hash_str))
        {
          return {
            found: true, 
            info: res.result.htlcs[i]
          };
        }
    }
    } 
    return undefined;
  }

  async redeem_htlc(txid, secret)
  {
    const res = await this.rpc_helper.invoke("atomics_redeem_htlc", 
    {
      tx_id: txid.toString('hex'), 
      origin_secret_as_hex: secret.toString('hex'), 
    });

    return res;
  }

  async check_htlc_redeemed(txid)
  {
    const res = await this.rpc_helper.invoke("atomics_check_htlc_redeemed", 
    {
      htlc_tx_id: txid,
    });

    return res;
  }
}

module.exports = SwapEntityZano;
 
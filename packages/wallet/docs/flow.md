# @livestreak/wallet — flow

How a consumer (observe / bookmaker / app edge) goes from injected config to a signed/submitted
chain action. The wallet is generic; domain actions (e.g. `registerMarket`) are composed by the
consumer on top of `account.sendTransaction`.

## Inputs (caller-injected, never baked)

```text
seed     runtime secret bytes / mnemonic (derived at the edge, e.g. password -> personal_sign -> sha256).
         NEVER serialized into config, the package, or the repo.
config   native WDK config, discriminated by chain:
           evm -> EvmErc4337WalletConfig (chainId, provider/rpc, bundlerUrl, paymasterUrl?,
                  entryPointAddress, safe module addresses, contractNetworks, gas mode)
           sui -> SuiWalletConfig (rpcUrl | provider, retries?)
         The app maps @livestreak/schema's EvmWalletInitConfig | SuiWalletInitConfig
         (the chain-discriminated WalletInit) -> the native WDK config at the edge.
```

## The path

```text
createWalletManager(chain, seed, config)        // switch on chain -> per-chain WalletManager
  -> manager.getAccount(i) | getAccountByPath(p) // BIP-44 (evm) / SLIP-0010 m/44'/784' (sui)
  -> account                                     // implements IWalletAccount
       .getAddress()                             // smart-account (evm Safe) / Ed25519 (sui) address
       .sign(message)                            // local, offline, deterministic
       .sendTransaction(tx)                      // evm: {to,data,value} -> UserOp via bundler/paymaster
                                                 // sui: {to,value} | Transaction -> signAndExecute
  -> account.dispose()                           // wipes the key from memory (call on teardown)
```

## Consumer composes domain actions

The wallet exposes the generic `sendTransaction`; the consumer builds the calldata. e.g. observe's
market layer:

```ts
const acct = await createWalletManager('evm', seed, cfg).getAccountByPath("0'/0/0")
await acct.sendTransaction({
  to: marketRegistryAddress, value: 0n,
  data: encodeFunctionData({ abi: marketRegistryAbi, functionName: 'registerMarket', args: [title, streamId] }),
})
```

`sendTransaction` returns a UserOp/tx hash, not a confirmation — poll the bundler/RPC for the
receipt to drive a `pending -> confirmed` lifecycle.

## Effects run at the edge

This package is a library of Promise/class WDK calls. The consuming Effect package wraps them in
`Effect.tryPromise`; the actual `await`/run happens at the CLI/app/test edge (e.g. the app's
`useStealthWallet` React provider), never inside library code.

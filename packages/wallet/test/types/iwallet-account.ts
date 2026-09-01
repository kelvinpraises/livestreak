// Compile-time proof that every per-chain account satisfies the shared WDK
// `IWalletAccount` contract — the basis of the "one interface" claim.
// Type-checked by `npm run check` (tsconfig.json includes test/types/**/*.ts);
// never emitted or run. If either account stops satisfying the interface, tsc
// errors here rather than the divergence slipping through silently.

import type { IWalletAccount } from '@tetherto/wdk-wallet'
import type { WalletAccountEvmErc4337 } from '#chains/evm.js'
import type { WalletAccountSui } from '#chains/sui.js'

type Satisfies<Iface, T extends Iface> = T

type _EvmSatisfiesIWalletAccount = Satisfies<IWalletAccount, WalletAccountEvmErc4337>
type _SuiSatisfiesIWalletAccount = Satisfies<IWalletAccount, WalletAccountSui>

export type { _EvmSatisfiesIWalletAccount, _SuiSatisfiesIWalletAccount }

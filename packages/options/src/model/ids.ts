// --- exports ---

export type MarketId = string & { readonly __brand: "MarketId" };
export type VaultId = string & { readonly __brand: "VaultId" };
export type UserAddress = string & { readonly __brand: "UserAddress" };
export type TokenAddress = string & { readonly __brand: "TokenAddress" };
export type TokenId = bigint & { readonly __brand: "TokenId" };

export const asMarketId = (value: string): MarketId => value as MarketId;
export const asVaultId = (value: string): VaultId => value as VaultId;
export const asUserAddress = (value: string): UserAddress => value as UserAddress;
export const asTokenAddress = (value: string): TokenAddress => value as TokenAddress;
export const asTokenId = (value: bigint): TokenId => value as TokenId;

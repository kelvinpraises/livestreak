export const defaultChains = [
  { name: "localhost", rpc: "http://127.0.0.1:8545" },
  {
    name: "monad-testnet",
    rpc: "https://testnet-rpc.monad.xyz",
    chainId: 10143,
    currency: "MON",
    explorer: "https://testnet.monadexplorer.com"
  }
] as const satisfies readonly {
  name: string;
  rpc: string;
  chainId?: number;
  currency?: string;
  explorer?: string;
}[];

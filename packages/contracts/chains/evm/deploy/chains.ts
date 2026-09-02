export const defaultChains = [
  { name: "localhost", rpc: "http://127.0.0.1:8545" },
  {
    name: "flow-testnet",
    rpc: "https://testnet.evm.nodes.onflow.org",
    chainId: 545,
    currency: "LVST",
    explorer: "https://evm-testnet.flowscan.io"
  }
] as const satisfies readonly {
  name: string;
  rpc: string;
  chainId?: number;
  currency?: string;
  explorer?: string;
}[];

export type Network = "testnet" | "mainnet";

export interface AppConfig {
  contractId: string;
  /** Account of the exuviae (burn collection) NFT contract. */
  exuviaeId: string;
  network: Network;
  nodeUrl: string;
  /** True when a custom RPC is configured: no wallet, views only. */
  readOnly: boolean;
  explorerUrl: string;
  repoUrl: string | null;
}

const DEFAULT_RPC_URL: Record<Network, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

const EXPLORER_URL: Record<Network, string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parseNetwork(raw: string | undefined): Network {
  if (raw === undefined || raw === "" || raw === "testnet") return "testnet";
  if (raw === "mainnet") return "mainnet";
  throw new ConfigError(`VITE_NETWORK must be "testnet" or "mainnet", got "${raw}".`);
}

function nonEmpty(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function loadConfig(env: ImportMetaEnv): AppConfig {
  const contractId = nonEmpty(env.VITE_CONTRACT_ID);
  if (!contractId) {
    throw new ConfigError("VITE_CONTRACT_ID is not set. Copy web/.env.example to web/.env and fill it in.");
  }
  const network = parseNetwork(nonEmpty(env.VITE_NETWORK) ?? undefined);
  const customNode = nonEmpty(env.VITE_NODE_URL);
  return {
    contractId,
    exuviaeId: nonEmpty(env.VITE_EXUVIAE_ID) ?? `exuviae.${contractId}`,
    network,
    nodeUrl: customNode ?? DEFAULT_RPC_URL[network],
    readOnly: customNode !== null,
    explorerUrl: EXPLORER_URL[network],
    repoUrl: nonEmpty(env.VITE_REPO_URL),
  };
}

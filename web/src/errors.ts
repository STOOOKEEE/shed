// Turns RPC / wallet / config failures into messages a user can act on.
import { ConfigError } from "./config";
import { DecodeError } from "./contract/decode";
import { AmountInputError } from "./format";

export interface ErrorReport {
  title: string;
  detail: string;
}

export interface ErrorContext {
  contractId: string;
  nodeUrl: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}

export function describeError(error: unknown, ctx: ErrorContext | null = null): ErrorReport {
  const message = messageOf(error);
  if (error instanceof ConfigError) return { title: "Configuration missing", detail: message };
  if (error instanceof AmountInputError) return { title: "Invalid amount", detail: message };
  if (error instanceof DecodeError) {
    return { title: "Unexpected contract response", detail: `The contract returned data this app does not understand (${message}).` };
  }
  const contract = ctx?.contractId ?? "the contract";
  if (/CodeDoesNotExist|no contract code|Contract code.*(not found|does not exist)/i.test(message)) {
    return { title: "Contract not deployed", detail: `No contract code is deployed at ${contract}.` };
  }
  if (/AccountDoesNotExist|UNKNOWN_ACCOUNT|account .* does not exist/i.test(message)) {
    return { title: "Contract account not found", detail: `The account ${contract} does not exist on this network.` };
  }
  if (/MethodNotFound|MethodResolveError|method .* not found/i.test(message)) {
    return { title: "Wrong contract", detail: `${contract} does not expose the MOLT interface (${message}).` };
  }
  if (/Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ENOTFOUND|timed? ?out|Load failed|50[234]|exceeded/i.test(message)) {
    const node = ctx?.nodeUrl ?? "the RPC node";
    return { title: "RPC unreachable", detail: `Could not reach ${node}. Check your connection or VITE_NODE_URL.` };
  }
  if (/reject|cancel|denied|closed/i.test(message)) return { title: "Cancelled", detail: message };
  return { title: "Error", detail: message };
}

// Read-only NEAR JSON-RPC client for the MOLT contract views. No keys, no signing.

import {
  asArray,
  asRecord,
  decodeCatalog,
  decodeContractConfig,
  decodeJournal,
  decodeMascot,
  decodeSkin,
  DecodeError,
} from "./decode.js";
import type { CatalogSlot, ContractConfig, JournalEntry, Mascot, Skin } from "./types.js";

const RPC_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 300;

export class RpcError extends Error {
  override name = "RpcError";
}

export type FetchFn = typeof fetch;

export class ChainClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly contractId: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Calls a view method at finality "final" and returns its JSON result. */
  async view(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.fetchFn(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "molt-bot",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: this.contractId,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new RpcError(`${method}: HTTP ${response.status}`);

    const body = asRecord(await response.json(), `${method} response`);
    if (body["error"] !== undefined) {
      throw new RpcError(`${method}: ${JSON.stringify(body["error"]).slice(0, MAX_ERROR_CHARS)}`);
    }
    const result = asRecord(body["result"], `${method} result`);
    // Contract panics come back as `result.error` with HTTP 200.
    if (typeof result["error"] === "string") throw new RpcError(`${method}: ${result["error"].slice(0, MAX_ERROR_CHARS)}`);

    const bytes = asArray(result["result"], `${method} result bytes`);
    if (!bytes.every((b): b is number => Number.isInteger(b) && typeof b === "number" && b >= 0 && b <= 255)) {
      throw new DecodeError(`${method}: result is not a byte array`);
    }
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  }

  async journal(limit: number): Promise<JournalEntry[]> {
    return decodeJournal(await this.view("journal", { limit }));
  }

  async mascot(): Promise<Mascot> {
    return decodeMascot(await this.view("mascot"));
  }

  async catalog(): Promise<CatalogSlot[]> {
    return decodeCatalog(await this.view("catalog"));
  }

  async config(): Promise<ContractConfig> {
    return decodeContractConfig(await this.view("config"));
  }

  async skin(skinId: number): Promise<Skin | null> {
    return decodeSkin(await this.view("skin", { skin_id: skinId }));
  }
}

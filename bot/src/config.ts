// Environment parsing and validation. Fails fast with every problem listed at once.

import { isLogLevel, type LogLevel } from "./log.js";

const DEFAULT_POLL_SECONDS = 30;
const MIN_POLL_SECONDS = 5;
const DEFAULT_MIN_POST_INTERVAL_SECONDS = 1800;
const DEFAULT_OUT_DIR = "out";
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const MAX_ACCOUNT_ID_LENGTH = 64;
const MIN_ACCOUNT_ID_LENGTH = 2;
// NEAR account id rule (nearcore `AccountId` validation).
const ACCOUNT_ID_PATTERN = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface XCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
}

export interface BotConfig {
  contractId: string;
  rpcUrl: string;
  pollSeconds: number;
  minPostIntervalSeconds: number;
  stateFile: string;
  outDir: string;
  dryRun: boolean;
  /** Present only when `dryRun` is false. */
  x: XCredentials | null;
  publicUrl: string | null;
  logLevel: LogLevel;
}

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Collects validation problems so the operator sees all of them in one run. */
class Reader {
  readonly problems: string[] = [];

  constructor(private readonly env: Env) {}

  optional(name: string): string | null {
    const value = this.env[name]?.trim();
    return value ? value : null;
  }

  required(name: string): string {
    const value = this.optional(name);
    if (value === null) this.problems.push(`${name} is required`);
    return value ?? "";
  }

  integer(name: string, fallback: number, min: number): number {
    const raw = this.optional(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min) {
      this.problems.push(`${name} must be an integer >= ${min}`);
      return fallback;
    }
    return Number(raw);
  }

  boolean(name: string, fallback: boolean): boolean {
    const raw = this.optional(name)?.toLowerCase() ?? null;
    if (raw === null) return fallback;
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    this.problems.push(`${name} must be true or false`);
    return fallback;
  }

  httpsUrl(name: string, value: string | null): string | null {
    if (value === null) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      this.problems.push(`${name} is not a valid URL (${error instanceof Error ? error.message : "parse error"})`);
      return null;
    }
    if (url.protocol !== "https:") this.problems.push(`${name} must use https://`);
    return url.toString();
  }
}

function isAccountId(value: string): boolean {
  return (
    value.length >= MIN_ACCOUNT_ID_LENGTH && value.length <= MAX_ACCOUNT_ID_LENGTH && ACCOUNT_ID_PATTERN.test(value)
  );
}

export function loadConfig(env: Env): BotConfig {
  const read = new Reader(env);

  const contractId = read.required("MOLT_CONTRACT_ID");
  if (contractId && !isAccountId(contractId)) read.problems.push("MOLT_CONTRACT_ID is not a valid NEAR account id");
  const rpcUrl = read.httpsUrl("MOLT_RPC_URL", read.required("MOLT_RPC_URL") || null) ?? "";
  const pollSeconds = read.integer("POLL_SECONDS", DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS);
  const minPostIntervalSeconds = read.integer("MIN_POST_INTERVAL_SECONDS", DEFAULT_MIN_POST_INTERVAL_SECONDS, 0);
  const stateFile = read.required("STATE_FILE");
  const outDir = read.optional("OUT_DIR") ?? DEFAULT_OUT_DIR;
  const dryRun = read.boolean("DRY_RUN", true);
  const publicUrl = read.httpsUrl("PUBLIC_URL", read.optional("PUBLIC_URL"));

  const logLevelRaw = read.optional("LOG_LEVEL") ?? DEFAULT_LOG_LEVEL;
  const logLevel = isLogLevel(logLevelRaw) ? logLevelRaw : DEFAULT_LOG_LEVEL;
  if (!isLogLevel(logLevelRaw)) read.problems.push("LOG_LEVEL must be debug, info, warn or error");

  const x: XCredentials | null = dryRun
    ? null
    : {
        consumerKey: read.required("X_CONSUMER_KEY"),
        consumerSecret: read.required("X_CONSUMER_SECRET"),
        accessToken: read.required("X_ACCESS_TOKEN"),
        accessSecret: read.required("X_ACCESS_SECRET"),
      };

  if (read.problems.length > 0) throw new ConfigError(`Invalid configuration: ${read.problems.join("; ")}`);
  return { contractId, rpcUrl, pollSeconds, minPostIntervalSeconds, stateFile, outDir, dryRun, x, publicUrl, logLevel };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

const BASE = {
  SHED_CONTRACT_ID: "shed-lobster-test.testnet",
  SHED_RPC_URL: "https://test.rpc.fastnear.com",
  STATE_FILE: "/tmp/shed-bot-state.json",
};
const CREDS = { X_CONSUMER_KEY: "ck", X_CONSUMER_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_SECRET: "as" };

test("defaults: dry run on, 30 s poll, 30 min batch interval, no X credentials needed", () => {
  const config = loadConfig(BASE);
  assert.equal(config.dryRun, true);
  assert.equal(config.x, null);
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.minPostIntervalSeconds, 1800);
  assert.equal(config.outDir, "out");
  assert.equal(config.publicUrl, null);
});

test("DRY_RUN=false without X credentials fails and names every missing variable", () => {
  assert.throws(
    () => loadConfig({ ...BASE, DRY_RUN: "false", X_CONSUMER_KEY: "ck" }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /X_CONSUMER_SECRET is required/.test(error.message) &&
      /X_ACCESS_TOKEN is required/.test(error.message) &&
      /X_ACCESS_SECRET is required/.test(error.message) &&
      !/X_CONSUMER_KEY is required/.test(error.message),
  );
});

test("DRY_RUN=false with credentials loads them", () => {
  const config = loadConfig({ ...BASE, ...CREDS, DRY_RUN: "false" });
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.x, { consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessSecret: "as" });
});

test("rejects bad values", () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ SHED_CONTRACT_ID: "" }, /SHED_CONTRACT_ID is required/],
    [{ SHED_CONTRACT_ID: "Bad..Id" }, /not a valid NEAR account id/],
    [{ SHED_RPC_URL: "http://rpc.example.com" }, /SHED_RPC_URL must use https/],
    [{ SHED_RPC_URL: "not a url" }, /SHED_RPC_URL is not a valid URL/],
    [{ POLL_SECONDS: "2" }, /POLL_SECONDS must be an integer >= 5/],
    [{ MIN_POST_INTERVAL_SECONDS: "-1" }, /MIN_POST_INTERVAL_SECONDS/],
    [{ DRY_RUN: "maybe" }, /DRY_RUN must be true or false/],
    [{ PUBLIC_URL: "http://shed.example.com" }, /PUBLIC_URL must use https/],
    [{ STATE_FILE: " " }, /STATE_FILE is required/],
    [{ LOG_LEVEL: "loud" }, /LOG_LEVEL/],
  ];
  for (const [override, pattern] of cases) {
    assert.throws(() => loadConfig({ ...BASE, ...override }), pattern);
  }
});

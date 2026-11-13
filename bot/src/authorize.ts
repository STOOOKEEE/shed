// One-off PIN-based OAuth 1.0a flow: lets the account that should post (e.g. @LobsterShed) authorize
// an app owned by another developer account. Writes X_ACCESS_TOKEN / X_ACCESS_SECRET into the env
// file; secrets are never printed.
//
// Usage: node --env-file=<keys.env> dist/authorize.js <keys.env>
//   <keys.env> must contain X_CONSUMER_KEY and X_CONSUMER_SECRET.

import { appendFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hmacSha1Signature, percentEncode, signatureBaseString } from "./oauth1.js";

const API = "https://api.x.com";
const NONCE_BYTES = 32;
const MS_PER_SECOND = 1000;
const OWNER_ONLY = 0o600;

function signedHeader(
  url: string,
  consumerKey: string,
  consumerSecret: string,
  extra: Readonly<Record<string, string>>,
  tokenSecret = "",
): string {
  const oauth: Record<string, string> = {
    ...extra,
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(NONCE_BYTES).toString("base64").replace(/\W/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / MS_PER_SECOND).toString(),
    oauth_version: "1.0",
  };
  oauth["oauth_signature"] = hmacSha1Signature(signatureBaseString("POST", url, oauth), consumerSecret, tokenSecret);
  const fields = Object.keys(oauth)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauth[key] ?? "")}"`);
  return `OAuth ${fields.join(", ")}`;
}

async function postForm(url: string, authorization: string): Promise<URLSearchParams> {
  const response = await fetch(url, { method: "POST", headers: { Authorization: authorization } });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}: ${body.slice(0, 300)}`);
  }
  return new URLSearchParams(body);
}

function required(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (!value) throw new Error(`X response is missing ${key}`);
  return value;
}

async function main(): Promise<void> {
  const keysFile = process.argv[2];
  const consumerKey = process.env["X_CONSUMER_KEY"];
  const consumerSecret = process.env["X_CONSUMER_SECRET"];
  if (!keysFile || !consumerKey || !consumerSecret) {
    throw new Error("Usage: node --env-file=<keys.env> dist/authorize.js <keys.env> (needs X_CONSUMER_KEY/SECRET)");
  }

  const requestUrl = `${API}/oauth/request_token`;
  const request = await postForm(requestUrl, signedHeader(requestUrl, consumerKey, consumerSecret, { oauth_callback: "oob" }));
  const requestToken = required(request, "oauth_token");
  const requestSecret = required(request, "oauth_token_secret");

  process.stdout.write(
    `\n1. Log in to x.com as the account that should post.\n2. Open:\n   ${API}/oauth/authorize?oauth_token=${requestToken}\n3. Click "Authorize app" and copy the PIN.\n\n`,
  );
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const pin = (await prompt.question("PIN: ")).trim();
  prompt.close();

  const accessUrl = `${API}/oauth/access_token`;
  const access = await postForm(
    accessUrl,
    signedHeader(accessUrl, consumerKey, consumerSecret, { oauth_token: requestToken, oauth_verifier: pin }, requestSecret),
  );
  const accessToken = required(access, "oauth_token");
  const accessSecret = required(access, "oauth_token_secret");
  const screenName = access.get("screen_name") ?? "unknown";

  appendFileSync(keysFile, `\nX_ACCESS_TOKEN=${accessToken}\nX_ACCESS_SECRET=${accessSecret}\n`);
  chmodSync(keysFile, OWNER_ONLY);
  process.stdout.write(`\nAuthorized as @${screenName}. Access token and secret written to ${keysFile}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

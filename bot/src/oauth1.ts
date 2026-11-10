// OAuth 1.0a HMAC-SHA1 request signing, as documented by X
// (docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature) and RFC 5849.
// JSON request bodies are not part of the signature; only query and oauth_* parameters are.

import { createHmac, randomBytes } from "node:crypto";
import type { XCredentials } from "./config.js";

const NONCE_BYTES = 32;
const MS_PER_SECOND = 1000;

/** RFC 3986 percent-encoding (encodeURIComponent leaves !'()* unescaped). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** METHOD&encoded-base-url&encoded-sorted-parameters. `params` holds raw (unencoded) values. */
export function signatureBaseString(method: string, url: string, params: Readonly<Record<string, string>>): string {
  const parsed = new URL(url);
  const all: Array<[string, string]> = [...Object.entries(params), ...parsed.searchParams.entries()];
  const parameterString = all
    .map(([key, value]): [string, string] => [percentEncode(key), percentEncode(value)])
    .sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : 1) : ka < kb ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  // URL.origin lowercases scheme/host and drops default ports, as the spec requires.
  const baseUrl = `${parsed.origin}${parsed.pathname}`;
  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(parameterString)].join("&");
}

export function hmacSha1Signature(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", key).update(baseString).digest("base64");
}

export interface SignOptions {
  method: string;
  url: string;
  credentials: XCredentials;
  /** Form-encoded body or extra parameters to sign (none for JSON bodies). */
  extraParams?: Readonly<Record<string, string>>;
  /** Fixed values for tests; generated otherwise. */
  nonce?: string;
  timestamp?: string;
}

/** Value for the `Authorization` header. */
export function authorizationHeader(options: SignOptions): string {
  const { credentials } = options;
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: options.nonce ?? randomBytes(NONCE_BYTES).toString("base64").replace(/\W/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: options.timestamp ?? Math.floor(Date.now() / MS_PER_SECOND).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const base = signatureBaseString(options.method, options.url, { ...options.extraParams, ...oauth });
  oauth["oauth_signature"] = hmacSha1Signature(base, credentials.consumerSecret, credentials.accessSecret);
  const fields = Object.keys(oauth)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauth[key] ?? "")}"`);
  return `OAuth ${fields.join(", ")}`;
}

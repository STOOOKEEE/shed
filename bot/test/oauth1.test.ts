import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizationHeader, hmacSha1Signature, percentEncode, signatureBaseString } from "../src/oauth1.js";

// Vector from docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature
const DOC = {
  url: "https://api.x.com/1.1/statuses/update.json?include_entities=true",
  status: "Hello Ladies + Gentlemen, a signed OAuth request!",
  credentials: {
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  },
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: "1318622958",
  baseString:
    "POST&https%3A%2F%2Fapi.x.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
  signature: "Ls93hJiZbQ3akF3HF3x1Bz8/zU4=",
};

test("percentEncode follows RFC 3986", () => {
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("An encoded string!"), "An%20encoded%20string%21");
  assert.equal(percentEncode("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice");
  assert.equal(percentEncode("☃"), "%E2%98%83");
  assert.equal(percentEncode("-._~*'()"), "-._~%2A%27%28%29");
});

test("signature base string matches the X documentation", () => {
  const base = signatureBaseString("post", DOC.url, {
    status: DOC.status,
    oauth_consumer_key: DOC.credentials.consumerKey,
    oauth_nonce: DOC.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: DOC.timestamp,
    oauth_token: DOC.credentials.accessToken,
    oauth_version: "1.0",
  });
  assert.equal(base, DOC.baseString);
});

test("HMAC-SHA1 signature matches the X documentation", () => {
  assert.equal(hmacSha1Signature(DOC.baseString, DOC.credentials.consumerSecret, DOC.credentials.accessSecret), DOC.signature);
});

test("authorization header carries the 7 oauth fields, percent-encoded", () => {
  const header = authorizationHeader({
    method: "POST",
    url: DOC.url,
    credentials: DOC.credentials,
    extraParams: { status: DOC.status },
    nonce: DOC.nonce,
    timestamp: DOC.timestamp,
  });
  assert.equal(
    header,
    'OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", ' +
      'oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D", oauth_signature_method="HMAC-SHA1", ' +
      'oauth_timestamp="1318622958", oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", oauth_version="1.0"',
  );
});

test("generated nonces are unique and alphanumeric", () => {
  const nonce = (h: string) => /oauth_nonce="([^"]+)"/.exec(h)?.[1];
  const a = nonce(authorizationHeader({ method: "POST", url: "https://api.x.com/2/tweets", credentials: DOC.credentials }));
  const b = nonce(authorizationHeader({ method: "POST", url: "https://api.x.com/2/tweets", credentials: DOC.credentials }));
  assert.match(a ?? "", /^\w{32,}$/);
  assert.notEqual(a, b);
});

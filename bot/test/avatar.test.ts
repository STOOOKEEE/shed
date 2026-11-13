import assert from "node:assert/strict";
import { test } from "node:test";
import { AVATAR_MIN_INTERVAL_MS, AvatarSync, type AvatarUpdater } from "../src/avatar.js";
import type { Mascot } from "../src/types.js";
import { XClient } from "../src/x.js";

const RED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#f00"/></svg>';
const BLUE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#00f"/></svg>';

function mascot(svg: string): Mascot {
  return { cycle: 1, svg, cycle_burned: "0", face: null };
}

class FakeUpdater implements AvatarUpdater {
  calls = 0;
  constructor(public succeed = true) {}
  async update(png: Buffer): Promise<boolean> {
    assert.ok(png.subarray(1, 4).toString() === "PNG");
    this.calls += 1;
    return this.succeed;
  }
}

function setup(updater: AvatarUpdater) {
  let svg = RED;
  let now = 1_000_000;
  const sync = new AvatarSync({ mascot: async () => mascot(svg) }, updater, () => now);
  return {
    sync,
    setSvg: (next: string) => (svg = next),
    advance: (ms: number) => (now += ms),
  };
}

test("avatar: uploaded on start, then only when the mascot changes", async () => {
  const updater = new FakeUpdater();
  const { sync, setSvg, advance } = setup(updater);
  await sync.tick();
  assert.equal(updater.calls, 1);
  advance(AVATAR_MIN_INTERVAL_MS);
  await sync.tick();
  assert.equal(updater.calls, 1, "same look: no upload");
  setSvg(BLUE);
  await sync.tick();
  assert.equal(updater.calls, 2, "new look: uploaded");
});

test("avatar: at most one upload per interval, the latest look wins", async () => {
  const updater = new FakeUpdater();
  const { sync, setSvg, advance } = setup(updater);
  await sync.tick();
  setSvg(BLUE);
  advance(AVATAR_MIN_INTERVAL_MS - 1);
  await sync.tick();
  assert.equal(updater.calls, 1, "too soon");
  advance(1);
  await sync.tick();
  assert.equal(updater.calls, 2);
});

test("avatar: a failed upload is retried after the interval, not on every poll", async () => {
  const updater = new FakeUpdater(false);
  const { sync, advance } = setup(updater);
  await sync.tick();
  await sync.tick();
  assert.equal(updater.calls, 1);
  advance(AVATAR_MIN_INTERVAL_MS);
  updater.succeed = true;
  await sync.tick();
  assert.equal(updater.calls, 2);
  advance(AVATAR_MIN_INTERVAL_MS);
  await sync.tick();
  assert.equal(updater.calls, 2, "synced: nothing left to do");
});

test("x: profile image goes form-encoded to the v1.1 endpoint, signed, and reports failures", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  let status = 200;
  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status });
  };
  const client = new XClient({ consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessSecret: "as" }, fetchFn);
  const png = Buffer.from("fake-png");
  assert.equal(await client.updateProfileImage(png), true);
  const call = seen[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.x.com/1.1/account/update_profile_image.json");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.match(headers.get("authorization") ?? "", /^OAuth .*oauth_signature="/);
  assert.equal(new URLSearchParams(String(call.init.body)).get("image"), png.toString("base64"));
  status = 403;
  assert.equal(await client.updateProfileImage(png), false);
});

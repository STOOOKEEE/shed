// X API client (OAuth 1.0a user context): media upload + create post (v2), profile picture (v1.1).
// Errors are logged with HTTP status and response body, never with request headers or secrets.

import type { XCredentials } from "./config.js";
import { asRecord, str } from "./decode.js";
import type { FetchFn } from "./chain.js";
import { errorFields, log } from "./log.js";
import { authorizationHeader } from "./oauth1.js";

export const X_API_BASE = "https://api.x.com";
const MEDIA_UPLOAD_URL = `${X_API_BASE}/2/media/upload`;
const CREATE_POST_URL = `${X_API_BASE}/2/tweets`;
/** v2 has no profile endpoint; this v1.1 one accepts OAuth 1.0a user tokens. */
const PROFILE_IMAGE_URL = `${X_API_BASE}/1.1/account/update_profile_image.json`;
const X_TIMEOUT_MS = 30_000;
const MAX_LOGGED_BODY_CHARS = 1000;

export class XClient {
  constructor(
    private readonly credentials: XCredentials,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Signed POST. Returns the response body, or null after logging any failure. */
  private async post(
    url: string,
    contentType: string,
    body: string,
    signedParams: Readonly<Record<string, string>>,
    action: string,
  ): Promise<string | null> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          authorization: authorizationHeader({ method: "POST", url, credentials: this.credentials, extraParams: signedParams }),
          "content-type": contentType,
        },
        body,
        signal: AbortSignal.timeout(X_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      log.error(`x ${action} request failed`, errorFields(error));
      return null;
    }
    if (!response.ok) {
      log.error(`x ${action} rejected`, { status: response.status, body: text.slice(0, MAX_LOGGED_BODY_CHARS) });
      return null;
    }
    return text;
  }

  /** JSON POST (bodies are not part of the OAuth signature). Returns `data.id`. */
  private async postJson(url: string, body: Record<string, unknown>, action: string): Promise<string | null> {
    const text = await this.post(url, "application/json", JSON.stringify(body), {}, action);
    if (text === null) return null;
    try {
      const data = asRecord(asRecord(JSON.parse(text), `${action} response`)["data"], `${action} data`);
      return str(data, "id", `${action} data`);
    } catch (error) {
      log.error(`x ${action} returned an unexpected body`, {
        ...errorFields(error),
        body: text.slice(0, MAX_LOGGED_BODY_CHARS),
      });
      return null;
    }
  }

  /** POST /2/media/upload (JSON, base64). Returns the media id. */
  uploadPng(png: Buffer): Promise<string | null> {
    return this.postJson(MEDIA_UPLOAD_URL, { media: png.toString("base64"), media_category: "tweet_image" }, "media upload");
  }

  /** POST /2/tweets. Returns the post id. */
  createPost(text: string, mediaId: string | null): Promise<string | null> {
    const body: Record<string, unknown> = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
    return this.postJson(CREATE_POST_URL, body, "create post");
  }

  /** POST /1.1/account/update_profile_image.json. Form-encoded, so `image` is signed too. */
  async updateProfileImage(png: Buffer): Promise<boolean> {
    const params = { image: png.toString("base64") };
    const body = new URLSearchParams(params).toString();
    return (await this.post(PROFILE_IMAGE_URL, "application/x-www-form-urlencoded", body, params, "profile image")) !== null;
  }
}

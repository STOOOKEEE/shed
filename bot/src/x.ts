// X API v2 client (OAuth 1.0a user context): media upload + create post.
// Errors are logged with HTTP status and response body, never with request headers or secrets.

import type { XCredentials } from "./config.js";
import { asRecord, str } from "./decode.js";
import type { FetchFn } from "./chain.js";
import { errorFields, log } from "./log.js";
import { authorizationHeader } from "./oauth1.js";

export const X_API_BASE = "https://api.x.com";
const MEDIA_UPLOAD_URL = `${X_API_BASE}/2/media/upload`;
const CREATE_POST_URL = `${X_API_BASE}/2/tweets`;
const X_TIMEOUT_MS = 30_000;
const MAX_LOGGED_BODY_CHARS = 1000;

export class XClient {
  constructor(
    private readonly credentials: XCredentials,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Signed JSON POST. Returns `data.id`, or null after logging any failure. */
  private async postJson(url: string, body: Record<string, unknown>, action: string): Promise<string | null> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          authorization: authorizationHeader({ method: "POST", url, credentials: this.credentials }),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
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
}

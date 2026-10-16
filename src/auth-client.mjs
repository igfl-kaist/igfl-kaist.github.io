export class AuthError extends Error {
  constructor(code, retryAfterSeconds, message) {
    super(message || code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export function validateEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function createAuthClient(endpoint, fetcher = fetch) {
  if (!validateEndpoint(endpoint)) throw new AuthError("NOT_CONFIGURED");
  return async function call(action, data = {}) {
    let response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        body: new URLSearchParams({ ...data, action }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new AuthError("CONNECTION_FAILED");
    }
    if (!response.ok || response.type === "opaque")
      throw new AuthError("CONNECTION_FAILED");
    let body;
    try {
      body = await response.json();
    } catch {
      throw new AuthError("INVALID_RESPONSE");
    }
    if (body?.protocol !== "igfl-auth-v1" || typeof body.ok !== "boolean")
      throw new AuthError("INVALID_RESPONSE");
    if (!body.ok)
      throw new AuthError(
        body.error?.code || "SERVER_ERROR",
        body.error?.retryAfterSeconds,
        body.error?.message,
      );
    return body.data;
  };
}

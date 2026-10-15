import { describe, expect, it } from "vitest";
import { scrubDeep, scrubEvent, scrubString } from "@/lib/sentry-scrub";

// Pencil authorize URLs are credentials (they log a browser into Pencil for an
// hour). These scrubbers run in Sentry's beforeSend / beforeBreadcrumb on the
// server, the edge and in the browser; a token must never survive them.

const SECRET = "SUPER-SECRET-TOKEN";
const AUTHORIZE_CALL =
  "https://apis.pencilapp.com/public/api/users/64f1a2b3c4d5e6f7a8b9c0d1/authorize?redirectUrl=https%3A%2F%2Fmy.pencilapp.com%2Fspaces%2Fx%3FstartCall%3Dtrue";
const TOKEN_URL = `https://my.pencilapp.com/spaces/x?loginMethod=token&loginType=api&token=${SECRET}`;

describe("scrubString", () => {
  it("drops everything after /authorize? (the redirectUrl and any token)", () => {
    expect(scrubString(AUTHORIZE_CALL)).toBe(
      "https://apis.pencilapp.com/public/api/users/64f1a2b3c4d5e6f7a8b9c0d1/authorize?[redacted]",
    );
    expect(scrubString(`GET ${AUTHORIZE_CALL} failed`)).toBe(
      "GET https://apis.pencilapp.com/public/api/users/64f1a2b3c4d5e6f7a8b9c0d1/authorize?[redacted] failed",
    );
  });

  it("redacts token-style query params but keeps harmless ones", () => {
    const out = scrubString(TOKEN_URL);
    expect(out).not.toContain(SECRET);
    expect(out).toBe("https://my.pencilapp.com/spaces/x?loginMethod=token&loginType=api&token=[redacted]");
    for (const name of ["access_token", "id_token", "refresh_token", "authToken"]) {
      expect(scrubString(`https://x.test/cb?${name}=${SECRET}&next=/home`)).toBe(`https://x.test/cb?${name}=[redacted]&next=/home`);
    }
    expect(scrubString("https://x.test/a?startCall=true&gv=true")).toBe("https://x.test/a?startCall=true&gv=true");
  });
});

describe("scrubDeep / scrubEvent", () => {
  it("scrubs nested strings and leaves other values alone", () => {
    const out = scrubDeep({ a: TOKEN_URL, n: 3, b: [AUTHORIZE_CALL, { c: TOKEN_URL, d: null }], e: true });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.n).toBe(3);
    expect(out.e).toBe(true);
    expect(out.b[1]).toMatchObject({ d: null });
  });

  it("scrubs request, message, exception values, breadcrumbs, extra, contexts and tags of an event", () => {
    const event = scrubEvent({
      request: { url: AUTHORIZE_CALL, headers: { referer: TOKEN_URL } },
      message: `fetch ${TOKEN_URL}`,
      transaction: `GET ${AUTHORIZE_CALL}`,
      exception: { values: [{ value: `Pencil 0 TIMEOUT: ${TOKEN_URL}` }] },
      breadcrumbs: [{ category: "fetch", data: { url: AUTHORIZE_CALL } }],
      extra: { url: TOKEN_URL },
      contexts: { trace: { data: { "http.url": TOKEN_URL } } },
      tags: { url: TOKEN_URL },
      // Not a scrubbed field: must pass through untouched.
      event_id: "abc",
    });
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(JSON.stringify(event)).not.toContain("redirectUrl=");
    expect(event.event_id).toBe("abc");
    expect(event.exception.values[0]!.value).toBe("Pencil 0 TIMEOUT: https://my.pencilapp.com/spaces/x?loginMethod=token&loginType=api&token=[redacted]");
  });
});

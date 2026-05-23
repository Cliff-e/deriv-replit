/**
 * deriv.ts — backend proxy endpoints for the Deriv PKCE auth system.
 *
 * All four endpoints are called by the frontend auth layer (src/auth/) in
 * ddbot-app. They proxy to Deriv's WebSocket API or OAuth2 REST endpoints so
 * that sensitive token operations stay server-side.
 *
 * Endpoints:
 *   POST /api/deriv/verify-token   — validates a stored Deriv token
 *   POST /api/deriv/refresh-token  — silently renews tokens via refresh_token
 *   POST /api/deriv/logout         — revokes a refresh_token at Deriv's endpoint
 *   POST /api/deriv/account-switch — validates a token for a given loginid
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// ---------------------------------------------------------------------------
// Config — override via environment variables for QA / staging environments
// ---------------------------------------------------------------------------
const DERIV_APP_ID = process.env["DERIV_APP_ID"] ?? "36300";
const DERIV_WS_HOST = process.env["DERIV_WS_HOST"] ?? "ws.derivws.com";
const DERIV_OAUTH_BASE = process.env["DERIV_OAUTH_BASE"] ?? "https://oauth.deriv.com/oauth2";
const WS_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helper: single Deriv WebSocket API call (Node 24 native WebSocket)
// ---------------------------------------------------------------------------
function derivWsCall(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const url = `wss://${DERIV_WS_HOST}/websockets/v3?app_id=${DERIV_APP_ID}`;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Deriv WebSocket request timed out"));
    }, WS_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(request));
    });

    ws.addEventListener("message", (evt: MessageEvent) => {
      clearTimeout(timer);
      ws.close();
      try {
        resolve(JSON.parse(evt.data as string) as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON from Deriv WebSocket"));
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Deriv WebSocket connection error"));
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/deriv/verify-token
// Body:    { token: string }
// Returns: { valid: true, loginid, currency, balance? }
//        | { valid: false, reason: string }
// ---------------------------------------------------------------------------
router.post("/verify-token", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ valid: false, reason: "Missing token" });
    return;
  }

  try {
    const data = await derivWsCall({ authorize: token });

    if (data["error"]) {
      const err = data["error"] as Record<string, unknown>;
      res.json({ valid: false, reason: (err["message"] ?? err["code"] ?? "Unauthorized") as string });
      return;
    }

    const auth = data["authorize"] as Record<string, unknown>;
    res.json({
      valid: true,
      loginid: auth["loginid"],
      currency: auth["currency"],
      balance: auth["balance"],
    });
  } catch (err) {
    req.log.error({ err }, "verify-token: Deriv WebSocket error");
    res.status(503).json({ valid: false, reason: "Could not reach Deriv API" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/deriv/refresh-token
// Body:    { refresh_token: string }
// Returns: { tokens: { token1?, acct1?, refresh_token?, expires_in? } }
//   401 when Deriv rejects the refresh_token
// ---------------------------------------------------------------------------
router.post("/refresh-token", async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    res.status(400).json({ error: "Missing refresh_token" });
    return;
  }

  try {
    const response = await fetch(`${DERIV_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
        client_id: DERIV_APP_ID,
      }),
    });

    if (response.status === 400 || response.status === 401) {
      res.status(401).json({ error: "Token refresh rejected by Deriv" });
      return;
    }

    if (!response.ok) {
      req.log.warn({ status: response.status }, "refresh-token: unexpected Deriv status");
      res.status(503).json({ error: "Deriv OAuth server error" });
      return;
    }

    const data = await response.json();
    res.json({ tokens: data });
  } catch (err) {
    req.log.error({ err }, "refresh-token: fetch error");
    res.status(503).json({ error: "Could not reach Deriv OAuth server" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/deriv/logout
// Body:    { refresh_token?: string }
// Returns: { success: true }  (always — local cleanup happens regardless)
// ---------------------------------------------------------------------------
router.post("/logout", async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (refresh_token) {
    try {
      await fetch(`${DERIV_OAUTH_BASE}/token/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: refresh_token,
          client_id: DERIV_APP_ID,
        }),
      });
    } catch (err) {
      req.log.warn({ err }, "logout: revocation request failed — proceeding with local logout");
    }
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/deriv/account-switch
// Body:    { loginid: string, token: string }
// Returns: { success: true }
//        | { success: false, reason: string }
// ---------------------------------------------------------------------------
router.post("/account-switch", async (req: Request, res: Response) => {
  const { loginid, token } = req.body as { loginid?: string; token?: string };

  if (!loginid || !token) {
    res.status(400).json({ success: false, reason: "Missing loginid or token" });
    return;
  }

  try {
    const data = await derivWsCall({ authorize: token });

    if (data["error"]) {
      const err = data["error"] as Record<string, unknown>;
      res.json({ success: false, reason: (err["message"] ?? err["code"] ?? "Unauthorized") as string });
      return;
    }

    const auth = data["authorize"] as Record<string, unknown>;
    if (auth["loginid"] !== loginid) {
      res.json({ success: false, reason: "Token does not match requested loginid" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "account-switch: Deriv WebSocket error");
    res.status(503).json({ success: false, reason: "Could not reach Deriv API" });
  }
});

export default router;

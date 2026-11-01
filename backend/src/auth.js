// Sign-in is delegated to loony-auth (OAuth 2.1 authorization code + PKCE,
// OpenID Connect). The browser is sent to loony-auth's hosted sign-in page;
// this server only ever sees a one-time code, which it exchanges using its
// client credentials. After verifying the ID token it keeps its own session
// (the `sessions` table + `session` cookie) exactly as before, and the
// reader/editor role stays local to this app.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pool } from "./db.js";
export const authRouter = Router();
export const digest = (value) => createHash("sha256").update(value).digest("hex");
const b64url = (buf) => buf.toString("base64url");
// Secure in production, and whenever the request came over HTTPS (through
// the Cloudflare tunnel: app.js trusts its X-Forwarded-Proto).
const secure = (req) => (process.env.NODE_ENV === "production" || req?.secure ? "; Secure" : "");
// Not plain `session`: cookies ignore the port, so loony-auth's own
// `session` cookie on the same host would overwrite this one (and vice versa).
const SESSION_COOKIE = "library_session";
const cookie = (req, token, age) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure(req)}`;
// Short-lived state/PKCE/nonce for one sign-in round trip, scoped to the
// auth routes only.
const txCookie = (req, value, age) =>
  `oauth_tx=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${age}${secure(req)}`;
const readCookie = (req, name) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
// CORS_ORIGIN may list several frontend origins, comma-separated (e.g. the
// Vite dev server and `vite preview`); the first is the default.
export const frontendOrigins = () =>
  (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
// The origin this request reached us on, as the browser sees it
// (https://books.lovegood.in through the tunnel, http://localhost:4000 locally).
const publicOrigin = (req) => `${req.protocol}://${req.get("host")}`;
// The frontend a sign-in started from (its Referer), if it's an allowed one;
// else this server itself when it serves the frontend on an allowed origin.
function startingFrontend(req) {
  try {
    const origin = new URL(req.headers.referer).origin;
    if (frontendOrigins().includes(origin)) return origin;
  } catch {}
  if (frontendOrigins().includes(publicOrigin(req))) return publicOrigin(req);
  return frontendOrigins()[0];
}

// OAUTH_REDIRECT_URI may list several callbacks, comma-separated - one per
// origin the library is reached on - each registered with loony-auth. A
// sign-in uses the one on the origin it came in on, else the first.
const redirectUris = () =>
  (process.env.OAUTH_REDIRECT_URI || "http://localhost:4000/api/auth/callback")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
function redirectUriFor(req) {
  const uris = redirectUris();
  return uris.find((uri) => new URL(uri).origin === publicOrigin(req)) ?? uris[0];
}

function config() {
  const cfg = {
    authUrl: (process.env.LOONY_AUTH_URL || "http://localhost:8450").replace(/\/+$/, ""),
    clientId: process.env.CLIENT_ID,
    tenantId: process.env.TENANT_ID,
    secret: process.env.SECRET_KEY,
  };
  if (!cfg.clientId || !cfg.tenantId || !cfg.secret)
    throw Object.assign(
      new Error("CLIENT_ID, TENANT_ID and SECRET_KEY must be set (see .env.example)"),
      { status: 503 },
    );
  return cfg;
}

// OpenID discovery document + JWKS, fetched once and cached.
let provider;
async function discover(authUrl) {
  if (provider?.authUrl === authUrl) return provider;
  const res = await fetch(`${authUrl}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`loony-auth discovery failed: ${res.status}`);
  const meta = await res.json();
  provider = { authUrl, meta, jwks: createRemoteJWKSet(new URL(meta.jwks_uri)) };
  return provider;
}

const sameString = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function authenticate(req, res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const { rows } = await pool.query(
        "select u.id,u.name,u.email,u.role from sessions s join users u on u.id=s.user_id where token_hash=$1 and expires_at>now()",
        [digest(token)],
      );
      req.user = rows[0];
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && !frontendOrigins().includes(req.headers.origin))
        return res.status(403).json({ error: "Origin not allowed" });
    }
    next();
  } catch (e) {
    next(e);
  }
}
export function editor(req, res, next) {
  if (req.user?.role !== "editor")
    return res.status(403).json({ error: "Editor account required" });
  next();
}
export function signedIn(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  next();
}

// Starts sign-in: a top-level browser navigation (not fetch), redirected to
// loony-auth's authorization endpoint.
authRouter.get("/auth/login", async (req, res, next) => {
  try {
    const cfg = config();
    const { meta } = await discover(cfg.authUrl);
    const tx = {
      state: b64url(randomBytes(32)),
      verifier: b64url(randomBytes(32)),
      nonce: b64url(randomBytes(32)),
      frontend: startingFrontend(req),
      redirectUri: redirectUriFor(req),
    };
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: tx.redirectUri,
      scope: "openid profile email",
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: b64url(createHash("sha256").update(tx.verifier).digest()),
      code_challenge_method: "S256",
    }).toString();
    res.setHeader("Set-Cookie", txCookie(req, b64url(Buffer.from(JSON.stringify(tx))), 600));
    res.redirect(303, url.toString());
  } catch (e) {
    next(e);
  }
});

authRouter.get("/auth/callback", async (req, res, next) => {
  let tx;
  try {
    tx = JSON.parse(Buffer.from(readCookie(req, "oauth_tx") || "", "base64url").toString());
  } catch {
    tx = null;
  }
  // Re-checked against the allowlist: never redirect somewhere CORS_ORIGIN
  // doesn't name.
  const frontend = frontendOrigins().includes(tx?.frontend)
    ? tx.frontend
    : frontendOrigins()[0];
  // Exactly the redirect_uri the authorization request used, re-checked
  // against the configured list.
  const redirectUri = redirectUris().includes(tx?.redirectUri) ? tx.redirectUri : redirectUris()[0];
  const fail = (reason) => {
    res.setHeader("Set-Cookie", txCookie(req, "", 0));
    res.redirect(303, `${frontend}/?auth_error=${encodeURIComponent(reason)}`);
  };
  if (!tx || !sameString(req.query.state, tx.state)) return fail("invalid_state");
  if (req.query.error) return fail("access_denied");
  if (typeof req.query.code !== "string") return fail("missing_code");
  try {
    const cfg = config();
    const { meta, jwks } = await discover(cfg.authUrl);
    const basic = Buffer.from(
      `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.secret)}`,
    ).toString("base64");
    const tokenRes = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: redirectUri,
        code_verifier: tx.verifier,
      }),
    });
    if (!tokenRes.ok) {
      console.error("loony-auth token exchange failed:", tokenRes.status, await tokenRes.text());
      return fail("token_exchange_failed");
    }
    const tokens = await tokenRes.json();
    const verify = (jwt) =>
      jwtVerify(jwt, jwks, {
        issuer: meta.issuer,
        audience: cfg.clientId,
        algorithms: ["EdDSA"],
      }).then((r) => r.payload);
    const id = await verify(tokens.id_token);
    const access = await verify(tokens.access_token);
    if (!sameString(id.nonce, tx.nonce)) return fail("invalid_nonce");
    // The client is already bound to one organization in loony-auth; this
    // is defense in depth that the user really belongs to our tenant.
    if (access.org_id !== cfg.tenantId || access.sub !== id.sub)
      return fail("wrong_tenant");
    // Only the ID token's identity is used; the refresh token isn't needed.
    if (tokens.refresh_token && meta.revocation_endpoint)
      fetch(meta.revocation_endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.refresh_token,
          token_type_hint: "refresh_token",
        }),
      }).catch(() => {});

    const email = typeof id.email === "string" ? id.email.toLowerCase() : "";
    const name =
      (typeof id.name === "string" && id.name.trim()) || email.split("@")[0] || "Reader";
    const { rows } = await pool.query(
      `insert into users(auth_subject,email,name) values($1,$2,$3)
       on conflict (auth_subject) do update set email=excluded.email, name=excluded.name
       returning id`,
      [id.sub, email, name.slice(0, 100)],
    );
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "insert into sessions values($1,$2,now()+interval '30 days')",
      [digest(token), rows[0].id],
    );
    res.setHeader("Set-Cookie", [txCookie(req, "", 0), cookie(req, token, 2592000)]);
    res.redirect(303, `${frontend}/`);
  } catch (e) {
    if (typeof e.code === "string" && e.code.startsWith("ERR_JW")) {
      console.error("loony-auth token verification failed:", e.code);
      return fail("invalid_token");
    }
    next(e);
  }
});

// Ends the library session, then hands back loony-auth's end-session URL:
// the frontend navigates there so the loony-auth session ends too (single
// sign-out), and loony-auth sends the browser back to /auth/logged-out.
authRouter.post("/auth/logout", async (req, res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  try {
    if (token)
      await pool.query("delete from sessions where token_hash=$1", [digest(token)]);
  } catch (error) {
    return next(error);
  }
  res.setHeader("Set-Cookie", cookie(req, "", 0));
  let logoutUrl;
  try {
    const cfg = config();
    const { meta } = await discover(cfg.authUrl);
    if (meta.end_session_endpoint) {
      const origin = frontendOrigins().includes(req.headers.origin)
        ? req.headers.origin
        : frontendOrigins()[0];
      const url = new URL(meta.end_session_endpoint);
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        // Must share an origin with the registered redirect URI (loony-auth
        // checks this), so it lives next to /auth/callback.
        post_logout_redirect_uri: new URL("/api/auth/logged-out", redirectUriFor(req)).toString(),
        state: origin,
      }).toString();
      logoutUrl = url.toString();
    }
  } catch (e) {
    // loony-auth unreachable or not configured: the library session is
    // still gone, which is what matters here.
    console.error("loony-auth end-session URL unavailable:", e.message);
  }
  res.json({ ok: true, logoutUrl });
});

// loony-auth's end-session endpoint comes back here; `state` is the
// frontend the sign-out started from, re-checked against the allowlist.
authRouter.get("/auth/logged-out", (req, res) => {
  const origin = frontendOrigins().includes(req.query.state)
    ? req.query.state
    : frontendOrigins()[0];
  res.redirect(303, `${origin}/`);
});

// "Account security" in the account menu: loony-auth's own page for phones,
// authenticator apps and recovery codes, for this app's organization.
authRouter.get("/auth/account", (req, res, next) => {
  try {
    const cfg = config();
    res.redirect(303, `${cfg.authUrl}/account?client_id=${encodeURIComponent(cfg.clientId)}`);
  } catch (e) {
    next(e);
  }
});
authRouter.get("/auth/me", (req, res) => res.json({ user: req.user || null }));

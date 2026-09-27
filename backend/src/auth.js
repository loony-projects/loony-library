import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { Router } from "express";
import { pool } from "./db.js";
export const authRouter = Router();
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const cookie = (token, age) =>
  `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export async function authenticate(req, res, next) {
  try {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("session="))
      ?.slice(8);
    if (token) {
      const { rows } = await pool.query(
        "select u.id,u.name,u.email,u.role from sessions s join users u on u.id=s.user_id where token_hash=$1 and expires_at>now()",
        [digest(token)],
      );
      req.user = rows[0];
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const allowed = process.env.CORS_ORIGIN || "http://localhost:5173";
      if (req.headers.origin && req.headers.origin !== allowed)
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
const attempts = new Map();
authRouter.post("/auth/:action", async (req, res, next) => {
  const { action } = req.params;
  if (action === "logout") {
    const token = req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
    try {
      if (token)
        await pool.query("delete from sessions where token_hash=$1", [
          digest(token),
        ]);
    } catch (error) {
      return next(error);
    }
    res.setHeader("Set-Cookie", cookie("", 0));
    return res.json({ ok: true });
  }
  if (!["login", "register"].includes(action)) return res.sendStatus(404);
  const key = req.ip,
    now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const attempt = attempts.get(key) || { count: 0, until: now + 900000 };
  attempts.set(key, attempt);
  if (++attempt.count > 20)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  const { email, password, name } = req.body;
  if (
    typeof email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    email.length > 254 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    return res.status(400).json({
      error: "Valid email and a password of 12–256 characters required",
    });
  try {
    let user;
    if (action === "register") {
      if (typeof name !== "string" || !name.trim() || name.length > 100)
        return res
          .status(400)
          .json({ error: "Name required (up to 100 characters)" });
      const r = await pool.query(
        "insert into users(email,name,password_hash) values($1,$2,$3) returning id,name,email,role",
        [email.toLowerCase().trim(), name.trim(), hashPassword(password)],
      );
      user = r.rows[0];
    } else {
      const r = await pool.query("select * from users where email=$1", [
        email.toLowerCase().trim(),
      ]);
      user = r.rows[0];
      if (
        !verifyPassword(
          password,
          user?.password_hash || hashPassword("dummy-password"),
        )
      )
        return res.status(401).json({ error: "Invalid email or password" });
      if (!user)
        return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "insert into sessions values($1,$2,now()+interval '30 days')",
      [digest(token), user.id],
    );
    res.setHeader("Set-Cookie", cookie(token, 2592000));
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "Account already exists" });
    next(e);
  }
});
authRouter.get("/auth/me", (req, res) => res.json({ user: req.user || null }));

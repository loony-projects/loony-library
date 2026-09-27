import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";
const Context = createContext({});
export const useAccount = () => useContext(Context);
export function AccountProvider({ children }) {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    api
      .get("/api/auth/me")
      .then((d) => setUser(d.user))
      .finally(() => setReady(true))
      .catch(() => {});
  }, []);
  return (
    <Context.Provider
      value={{ user, setUser, ready, editor: user?.role === "editor" }}
    >
      {children}
    </Context.Provider>
  );
}
export default function Account() {
  const { user, setUser } = useAccount();
  const [mode, setMode] = useState("login"),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api.post(
        `/api/auth/${mode}`,
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setUser(d.user);
      setOpen(false);
      window.location.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account no-print">
      {user ? (
        <>
          <span>
            {user.name} · {user.role}
          </span>{" "}
          <button
            onClick={async () => {
              await api.post("/api/auth/logout", {});
              setUser(null);
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <button onClick={() => setOpen(!open)}>Sign in / Create account</button>
      )}
      {open && (
        <form className="panel" onSubmit={submit}>
          <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
          {mode === "register" && (
            <label>
              Name
              <input name="name" required maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          <p>Use at least 12 characters.</p>
          <button disabled={busy}>{busy ? "Working…" : "Continue"}</button>
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create account" : "Use existing account"}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}

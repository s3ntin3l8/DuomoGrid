/**
 * Headers for POST /auth/pair. A leftover token must not be sent in proxy mode:
 * any Authorization header is the token path, so a stale token 401s a signed-in desk.
 */
export function pairHeaders(mode, storedToken) {
  if (mode === "proxy" || !storedToken) return {};
  return { authorization: `Bearer ${storedToken}` };
}

/** Runs in the desk page. The popup stores the tab origin, not a host the server guessed. */
export async function pairFromPage() {
  const sessionResponse = await fetch("/auth/session");
  const session = sessionResponse.ok ? await sessionResponse.json() : { mode: "token" };
  const token = localStorage.getItem("duomo.token") || "";
  const response = await fetch("/auth/pair", { method: "POST", headers: pairHeaders(session.mode, token) });
  if (!response.ok) return { ok: false, status: response.status };
  const body = await response.json();
  const ingestToken = String(body.ingestToken ?? "");
  if (!ingestToken) return { ok: false, status: response.status };
  return { ok: true, ingestToken };
}

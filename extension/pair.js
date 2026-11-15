/**
 * Runs in the desk page via executeScript, which stringifies this function and
 * drops the module. The header rule stays inline: a leftover token must not be
 * sent in proxy mode, because any Authorization header is the token path.
 */
export async function pairFromPage() {
  const sessionResponse = await fetch("/auth/session", { signal: AbortSignal.timeout(3000) });
  const session = sessionResponse.ok ? await sessionResponse.json() : { mode: "token" };
  const token = localStorage.getItem("duomo.token") || "";
  const headers = session.mode === "proxy" || !token ? {} : { authorization: `Bearer ${token}` };
  const response = await fetch("/auth/pair", { method: "POST", headers, signal: AbortSignal.timeout(3000) });
  if (!response.ok) return { ok: false, status: response.status };
  const body = await response.json();
  const ingestToken = String(body.ingestToken ?? "");
  if (!ingestToken) return { ok: false, status: response.status };
  return { ok: true, ingestToken };
}

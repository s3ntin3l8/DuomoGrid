/** True when `latest` is a newer dotted version than `current`. A non-version is not newer. */
export function isNewer(latest, current) {
  const next = parts(latest);
  const have = parts(current);
  if (!next || !have) return false;
  const length = Math.max(next.length, have.length);
  for (let i = 0; i < length; i += 1) {
    const left = next[i] ?? 0;
    const right = have[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

function parts(value) {
  const text = String(value ?? "").replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(text)) return null;
  return text.split(".").map((part) => Number(part));
}

/** Zip attached to a GitHub release, or the release page when the asset is missing. */
export function updateLink(release, version) {
  const name = `duomogrid-extension-${version}.zip`;
  const asset = (release.assets ?? []).find((item) => item.name === name);
  return asset?.browser_download_url || release.html_url || "";
}

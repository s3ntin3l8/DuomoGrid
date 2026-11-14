export function eur(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function area(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${num(value, value % 1 === 0 ? 0 : 1)} m²`;
}

export function moveLabel(change: number | null): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const rounded = Math.round(Math.abs(change)) * Math.sign(change);
  if (rounded === 0) return null;
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
}

export function perM2Text(buy: boolean, perM2: number | null | undefined): string | null {
  if (perM2 == null || !Number.isFinite(perM2)) return null;
  return `${eur(perM2, buy ? 0 : 2)} / m²`;
}

export type DeskHistory = {
  totalChangePct: number | null;
  reductions: number;
  startedBasis: "portal" | "saved";
  daysOnMarket: number;
};

/** "−3% · 2 cuts · 45 d online" for a list row. The time is shown only when the portal gave the date. */
export function historyText(history: DeskHistory): string | null {
  const change = moveLabel(history.totalChangePct);
  const cuts = history.reductions > 0 ? `${history.reductions} ${history.reductions === 1 ? "cut" : "cuts"}` : null;
  const online = history.startedBasis === "portal" ? `${history.daysOnMarket} d online` : null;
  const text = [change, cuts, online].filter(Boolean).join(" · ");
  return text || null;
}

export function historyTone(history: DeskHistory): "down" | "up" | undefined {
  const change = history.totalChangePct;
  if (change == null || Math.round(Math.abs(change)) === 0) return undefined;
  return change < 0 ? "down" : "up";
}

export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export const STATUSES = [
  { id: "open", label: "Open" },
  { id: "visit", label: "Viewing" },
  { id: "offer", label: "Offer" },
  { id: "pass", label: "Pass" },
] as const;

export function statusLabel(id: string): string {
  return STATUSES.find((item) => item.id === id)?.label ?? id;
}

export function propertyLabel(type: string): string {
  switch (type) {
    case "apartment":
      return "Apartment";
    case "house":
      return "House";
    case "land":
      return "Plot";
    case "multi":
      return "Multi-family";
    default:
      return "Other";
  }
}

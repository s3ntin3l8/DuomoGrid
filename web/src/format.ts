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

export function priceMove(observations: { priceEur: number | null }[]): number | null {
  const current = observations[0]?.priceEur;
  const previous = observations[1]?.priceEur;
  if (current == null || previous == null || !(previous > 0) || current === previous) return null;
  return ((current - previous) / previous) * 100;
}

export function moveLabel(change: number | null): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return null;
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
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

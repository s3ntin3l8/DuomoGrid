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

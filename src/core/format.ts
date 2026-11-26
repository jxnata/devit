/** Display helpers shared by commands and the daemon log. Times show in local time. */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-26 09:00" (or with seconds) in local time; "-" for null. */
export function localTime(value: string | Date | null | undefined, seconds = false): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** "$0.12", "<$0.01", or "-" when unknown. */
export function usd(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

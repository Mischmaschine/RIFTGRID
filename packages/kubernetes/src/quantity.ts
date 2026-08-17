const binary: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40 };
const decimal: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };

export function parseCpuMillicores(value = "0"): number {
  if (value.endsWith("m")) return Math.round(Number(value.slice(0, -1)));
  if (value.endsWith("n")) return Math.round(Number(value.slice(0, -1)) / 1e6);
  return Math.round(Number(value) * 1000);
}

export function parseBytes(value = "0"): number {
  const match = value.match(/^([\d.]+)([A-Za-z]+)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const suffix = match[2] ?? "";
  return Math.round(amount * (binary[suffix] ?? decimal[suffix] ?? 1));
}

export function bytesToMiB(value: number): number { return Math.floor(value / 2 ** 20); }
export function bytesToGiB(value: number): number { return Math.floor(value / 2 ** 30); }

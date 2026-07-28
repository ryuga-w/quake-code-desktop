export type WebSource = {
  url: string;
  hostname: string;
  title?: string;
};

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/[.,;:!?)]+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || undefined;
  } catch {
    return undefined;
  }
}

function addSource(map: Map<string, WebSource>, rawUrl: string, title?: string) {
  const url = normalizeUrl(rawUrl);
  if (!url) return;
  const hostname = hostFromUrl(url);
  if (!hostname) return;
  const existing = map.get(hostname);
  const cleanTitle = title?.trim() || undefined;
  if (existing) {
    if (!existing.title && cleanTitle) map.set(hostname, { ...existing, title: cleanTitle });
    return;
  }
  map.set(hostname, { url, hostname, title: cleanTitle });
}

function walkValue(value: unknown, map: Map<string, WebSource>, depth = 0) {
  if (depth > 7 || value == null) return;

  if (typeof value === "string") {
    for (const match of value.matchAll(URL_IN_TEXT)) {
      addSource(map, match[0]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, map, depth + 1);
    return;
  }

  const rec = asRecord(value);
  if (!rec) return;

  const title = typeof rec.title === "string" ? rec.title : typeof rec.name === "string" ? rec.name : undefined;
  const directUrl = [rec.url, rec.href, rec.link, rec.uri, rec.source_url, rec.sourceUrl]
    .find((v) => typeof v === "string") as string | undefined;
  if (directUrl) addSource(map, directUrl, title);

  if (Array.isArray(rec.urls)) {
    for (const u of rec.urls) {
      if (typeof u === "string") addSource(map, u, title);
      else walkValue(u, map, depth + 1);
    }
  }

  if (Array.isArray(rec.sources)) walkValue(rec.sources, map, depth + 1);
  if (Array.isArray(rec.results)) walkValue(rec.results, map, depth + 1);
  if (Array.isArray(rec.citations)) walkValue(rec.citations, map, depth + 1);
  if (Array.isArray(rec.items)) walkValue(rec.items, map, depth + 1);

  for (const nested of Object.values(rec)) {
    if (nested === rec.url || nested === rec.href) continue;
    walkValue(nested, map, depth + 1);
  }
}

function urlsFromArgs(args: unknown): string[] {
  const rec = asRecord(args);
  if (!rec) return [];
  const out: string[] = [];
  for (const key of ["url", "href", "uri", "link"]) {
    if (typeof rec[key] === "string") out.push(rec[key] as string);
  }
  if (Array.isArray(rec.urls)) {
    for (const u of rec.urls) {
      if (typeof u === "string") out.push(u);
    }
  }
  return out;
}

/** Unique web sources from tool args, streaming output, and structured result */
export function extractWebSources(input: {
  args?: unknown;
  output?: string;
  result?: unknown;
  limit?: number;
}): WebSource[] {
  const map = new Map<string, WebSource>();
  const limit = input.limit ?? 12;

  for (const url of urlsFromArgs(input.args)) addSource(map, url);
  if (input.output) walkValue(input.output, map, 0);
  if (input.result) walkValue(input.result, map, 0);

  return [...map.values()].slice(0, limit);
}

export function faviconUrl(hostname: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
}

/** Tek bir URL'den guvenli sekilde hostname cikar (www. atilir). */
export function hostFromUrlSafe(url: string): string | undefined {
  return hostFromUrl(url);
}

/** Tek bir URL'i WebSource'a cevir (browser_navigate gibi tekil tool'lar icin). */
export function sourceFromUrl(url: string, title?: string): WebSource | undefined {
  const normalized = normalizeUrl(url);
  if (!normalized) return undefined;
  const hostname = hostFromUrl(normalized);
  if (!hostname) return undefined;
  return { url: normalized, hostname, title: title?.trim() || undefined };
}

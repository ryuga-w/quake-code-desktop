/**
 * Entry HTML must always be revalidated so it cannot reference chunks from an
 * older build. Vite assets are content-hashed and safe to cache immutably.
 */
export function staticCacheControl(pathname: string): string {
  const normalizedPath = pathname.toLowerCase();
  if (normalizedPath.endsWith(".html")) return "no-store";
  if (normalizedPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}

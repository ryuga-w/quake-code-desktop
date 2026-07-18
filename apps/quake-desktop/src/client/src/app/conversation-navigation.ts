export function normalizeSessionMetadataPath(value: string): string {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function normalizeWorkspaceNavigationKey(path: string): string {
  return String(path || "").replace(/[\\/]+$/, "").toLowerCase();
}

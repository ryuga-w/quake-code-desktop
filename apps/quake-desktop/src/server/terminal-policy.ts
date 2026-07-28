export type TerminalPolicyMode = "safe" | "allow-all" | "disabled";

export interface TerminalPolicyDecision {
  allowed: boolean;
  reason?: string;
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/i, reason: "Özyinelemeli zorla silme engellendi" },
  { pattern: /\bdel\s+.*\/s\b/i, reason: "Özyinelemeli silme engellendi" },
  { pattern: /\brmdir\s+.*\/s\b/i, reason: "Özyinelemeli klasör silme engellendi" },
  { pattern: /\bformat\b/i, reason: "Disk formatlama komutları engellendi" },
  { pattern: /\bgit\s+clean\s+.*-f/i, reason: "git clean zorla silme engellendi" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "git reset --hard engellendi" },
  { pattern: /\bnpm\s+publish\b/i, reason: "Paket yayınlama komutları engellendi" },
  { pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|powershell|pwsh|cmd)\b/i, reason: "Ağdan indirip shell'e aktarma engellendi" },
  { pattern: /\b(?:powershell|pwsh)\b[\s\S]*\b(?:Invoke-Expression|iex)\b/i, reason: "PowerShell Invoke-Expression engellendi" },
  { pattern: /\bchmod\s+777\b/i, reason: "chmod 777 engellendi" },
];

export class TerminalPolicy {
  constructor(private readonly mode: TerminalPolicyMode = "safe") {}

  check(command: string): TerminalPolicyDecision {
    if (this.mode === "disabled") return { allowed: false, reason: "Terminal paneli kapalı" };
    if (this.mode === "allow-all") return { allowed: true };

    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(command)) return { allowed: false, reason: rule.reason };
    }
    return { allowed: true };
  }
}

export function parseTerminalPolicyMode(value: string | undefined): TerminalPolicyMode {
  if (value === "allow-all" || value === "disabled" || value === "safe") return value;
  return "safe";
}

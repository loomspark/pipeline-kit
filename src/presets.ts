import type { HardRule } from "./types.ts";

// Kit-provided hard rules a project switches on with `hardRules.presets`.
// Patterns cover common credential formats across vendors; they are a backstop,
// not a replacement for the host's own secret scanning.

const SECRETS: HardRule[] = [
  {
    id: "secrets-env-file",
    description: "Environment files hold secret values and must never be committed (only .env.example).",
    paths: [".env", ".env.*", "**/.env", "**/.env.*"],
    exceptPaths: [".env.example", "**/.env.example"],
    forbidFile: true,
  },
  {
    id: "secrets-credential",
    description: "Added line looks like a credential. Secrets belong in the secret store; config names them only.",
    paths: ["**"],
    forbidPatterns: [
      "-----BEGIN [A-Z ]*PRIVATE KEY-----",
      "\\bsk-ant-[A-Za-z0-9_-]{20,}",
      "\\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}",
      "\\bAIza[0-9A-Za-z_-]{35}\\b",
      "\\bgh[pousr]_[A-Za-z0-9]{36,}\\b",
      "\\bgithub_pat_[A-Za-z0-9_]{40,}",
      "\\bxox[abprs]-[A-Za-z0-9-]{10,}",
      "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
      "\\b[rs]k_live_[0-9A-Za-z]{20,}",
      "\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b",
      "\\b(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|rediss?)://[^\\s:@/]+:(?!(?:password|pass|PASSWORD|secret)@)[^\\s@/$<{]{6,}@",
    ],
  },
];

export const PRESETS: Record<string, HardRule[]> = { secrets: SECRETS };

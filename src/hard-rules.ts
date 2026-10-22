import { matchesAny } from "./glob.ts";
import type { Change } from "./diff.ts";
import type { HardRule } from "./types.ts";

// Hard rules: things that must never land, checked on every diff. Only added or
// modified files and added lines are checked, so removing a violation always passes.
// A finding carries rule, file and line, never the matched text: the text may be a
// secret or someone's personal data, and CI logs are not a safe place for either.

export interface Finding {
  rule: HardRule;
  path: string;
  /** Absent for forbidFile findings. */
  line?: number;
}

export function checkHardRules(change: Change, rules: readonly HardRule[]): Finding[] {
  const findings: Finding[] = [];
  const present = change.files.filter((f) => f.status !== "D");
  for (const rule of rules) {
    const flags = rule.ignoreCase ? "i" : "";
    const patterns = (rule.forbidPatterns ?? []).map((p) => new RegExp(p, flags));
    for (const { path } of present) {
      if (!matchesAny(path, rule.paths) || matchesAny(path, rule.exceptPaths)) continue;
      if (rule.forbidFile) {
        findings.push({ rule, path });
        continue;
      }
      for (const { line, text } of change.added.get(path) ?? []) {
        if (patterns.some((re) => re.test(text))) findings.push({ rule, path, line });
      }
    }
  }
  return findings;
}

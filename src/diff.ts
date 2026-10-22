import { execFileSync } from "node:child_process";

// What a change touched. Content is held in memory only to run hard rules against it;
// nothing in the kit prints it (CLAUDE.md privacy rules).

export type Status = "A" | "M" | "D" | "T" | "U" | "X";

export interface ChangedFile {
  path: string;
  status: Status;
}

export interface AddedLine {
  line: number;
  text: string;
}

export interface Change {
  files: ChangedFile[];
  added: Map<string, AddedLine[]>;
}

/** Parse `git diff --name-status --no-renames` output. */
export function parseNameStatus(out: string): ChangedFile[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [status, ...rest] = row.split("\t");
      return { status: status[0] as Status, path: unquote(rest.join("\t")) };
    });
}

/** Parse `git diff -U0 --no-renames` output into added lines per file. */
export function parseAddedLines(out: string): Map<string, AddedLine[]> {
  const added = new Map<string, AddedLine[]>();
  let current: AddedLine[] | null = null;
  let next = 0;
  // File headers (---/+++) come only between "diff --git" and the first hunk; after that a
  // line starting "+++" is an added line whose text starts "++".
  let inHeader = false;
  for (const raw of out.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      current = null;
      inHeader = true;
    } else if (inHeader && raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      if (target === "/dev/null") {
        current = null;
      } else {
        const path = unquote(target).replace(/^b\//, "");
        current = [];
        added.set(path, current);
      }
    } else if (inHeader && !raw.startsWith("@@")) {
      continue;
    } else if (raw.startsWith("@@")) {
      inHeader = false;
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      next = m ? Number(m[1]) : 0;
    } else if (current && raw.startsWith("+")) {
      current.push({ line: next, text: raw.slice(1) });
      next++;
    }
  }
  return added;
}

function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  // git C-quotes unusual paths; decode octal escapes as UTF-8 bytes.
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      const oct = /^[0-7]{3}/.exec(body.slice(i + 1));
      if (oct) {
        bytes.push(parseInt(oct[0], 8));
        i += 3;
        continue;
      }
      const esc: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
      bytes.push(...Buffer.from(esc[body[i + 1]] ?? body[i + 1]));
      i++;
    } else {
      bytes.push(...Buffer.from(body[i]));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** Files and added lines between the merge base of `base` and `head`, and `head`. */
export function readChange(base: string, head: string): Change {
  const range = `${base}...${head}`;
  const files = parseNameStatus(git(["diff", "--name-status", "--no-renames", range]));
  const added = parseAddedLines(git(["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", range]));
  return { files, added };
}

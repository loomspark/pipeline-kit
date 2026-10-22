// Path globs for risk and hard rules. Deliberately small and explicit so the semantics
// are the same everywhere the kit runs (docs/design.md#globs):
//   - anchored at the repo root: `*.md` matches only root files, use `**/*.md` for any depth
//   - `**` matches any number of path segments, dotfiles and dot-directories included
//   - `*` matches within one segment (including a leading dot), `?` one character
//   - `{a,b}` alternatives, `[abc]` character classes
// Dotfiles match on purpose: `.env` and `.github/` are exactly what risk and secret rules need to see.

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  let re = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atSegmentStart = i === 0 || glob[i - 1] === "/";
        if (atSegmentStart && glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      braces++;
      re += "(?:";
    } else if (c === "}" && braces > 0) {
      braces--;
      re += ")";
    } else if (c === "," && braces > 0) {
      re += "|";
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        re += "\\[";
      } else {
        const body = glob.slice(i + 1, end).replace(/\\/g, "\\\\");
        re += `[${body.startsWith("!") ? "^" + body.slice(1) : body}]`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^$()|\\\]]/g, "\\$&");
    }
  }
  if (braces > 0) throw new Error(`Unclosed "{" in glob: ${glob}`);
  const compiled = new RegExp(`^${re}$`);
  cache.set(glob, compiled);
  return compiled;
}

export function matchesAny(path: string, globs: readonly string[] | undefined): boolean {
  return !!globs && globs.some((g) => globToRegExp(g).test(path));
}

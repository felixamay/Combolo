const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "fk", "sk", "bk", "if", "ik", "cd", "ud", "sd", "rc", "the", "club", "de", "ca", "sv", "vfl", "vfb", "tsv", "ssc", "us", "ss", "rcd", "calcio"]);

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalised key for a team / league name: lower-case, ASCII, no punctuation, no club-suffix noise. */
export function normName(name: string): string {
  let s = stripDiacritics(name).toLowerCase();
  s = s.replace(/&/g, " and ").replace(/\butd\b/g, "united").replace(/\bman\b/g, "manchester").replace(/\bst\.?\b/g, "saint").replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = s.split(" ").filter((t) => t && !STOP.has(t));
  return (tokens.length ? tokens : s.split(" ")).join(" ");
}

export function normLeagueName(name: string): string {
  return normName(name.replace(/\b(uefa|the)\b/gi, " "));
}

/**
 * Person key for tennis players: `<tour>|<first initial>|<last token>`.
 * "M. Navone" and "Mariano Navone" resolve to the same key; hyphenated surnames collapse to their last part.
 */
export function playerKey(name: string, tour: string | null | undefined): string {
  const tokens = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z\s.'-]/g, " ")
    .replace(/[-']/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\./g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return `${(tour ?? "?").toLowerCase()}|?|?`;
  const last = tokens[tokens.length - 1];
  // "Nadal R." style (surname first, trailing initial)
  if (tokens.length >= 2 && last.length === 1) return `${(tour ?? "?").toLowerCase()}|${last}|${tokens[0]}`;
  const initial = tokens[0][0];
  return `${(tour ?? "?").toLowerCase()}|${initial}|${last}`;
}

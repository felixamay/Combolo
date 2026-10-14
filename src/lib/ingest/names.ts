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

const DEMONYMS: Record<string, string> = {
  english: "england", spanish: "spain", german: "germany", italian: "italy", french: "france", dutch: "netherlands", portuguese: "portugal",
  scottish: "scotland", turkish: "turkey", belgian: "belgium", russian: "russia", brazilian: "brazil", argentine: "argentina", argentinian: "argentina",
  mexican: "mexico", american: "usa", australian: "australia", japanese: "japan", swiss: "switzerland", austrian: "austria", greek: "greece",
  danish: "denmark", swedish: "sweden", norwegian: "norway", polish: "poland", czech: "czechia", ukrainian: "ukraine", chinese: "china", korean: "south korea",
  irish: "ireland", welsh: "wales", croatian: "croatia", serbian: "serbia", hungarian: "hungary", romanian: "romania", finnish: "finland", canadian: "canada",
};

const COUNTRY_ALIASES: Record<string, string> = { "united states": "usa", "united states of america": "usa", us: "usa", "united kingdom": "uk", "korea republic": "south korea", "czech republic": "czechia", holland: "netherlands" };

export function normCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = stripDiacritics(country).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!c || c === "world" || c === "international") return null;
  return COUNTRY_ALIASES[c] ?? c;
}

export function normLeagueName(name: string): string {
  return normName(name.replace(/\b(uefa|the|efl)\b/gi, " "));
}

/**
 * League identity used to merge the same competition across providers: the normalised name without a leading
 * demonym ("English Premier League" -> "premier league" + england), plus the country when known. Without the
 * country, "Premier League" in England and in Russia would be merged.
 */
export function leagueIdentity(name: string, country: string | null | undefined, aliases: Record<string, string> = {}): { base: string; country: string | null } {
  let base = normLeagueName(name);
  let c = normCountry(country);
  const tokens = base.split(" ");
  if (tokens.length > 1 && DEMONYMS[tokens[0]]) {
    c = c ?? DEMONYMS[tokens[0]];
    base = tokens.slice(1).join(" ");
  }
  const aliasKey = c ? `${base}@${c}` : base;
  const aliased = aliases[aliasKey];
  if (aliased) {
    const [b, ac] = aliased.split("@");
    return { base: b, country: ac ?? c };
  }
  return { base, country: c };
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

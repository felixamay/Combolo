export type SportId =
  | "football"
  | "basketball"
  | "tennis"
  | "hockey"
  | "baseball"
  | "american-football"
  | "rugby"
  | "volleyball"
  | "handball";

export interface SportMeta {
  id: SportId;
  name: string;
  slug: string;
  icon: string;
  /** Tailwind-independent hex colour used for badges. */
  color: string;
  hasDraw: boolean;
  /** Individual participants (tennis) rather than teams. */
  individual: boolean;
  /** Home advantage expressed in log-odds (configurable in config/admin.ts). */
  pluralLabel: string;
}

export const SPORTS: Record<SportId, SportMeta> = {
  football: { id: "football", name: "Football", slug: "football", icon: "⚽", color: "#16a34a", hasDraw: true, individual: false, pluralLabel: "football matches" },
  basketball: { id: "basketball", name: "Basketball", slug: "basketball", icon: "🏀", color: "#ea580c", hasDraw: false, individual: false, pluralLabel: "basketball games" },
  tennis: { id: "tennis", name: "Tennis", slug: "tennis", icon: "🎾", color: "#ca8a04", hasDraw: false, individual: true, pluralLabel: "tennis matches" },
  hockey: { id: "hockey", name: "Ice Hockey", slug: "hockey", icon: "🏒", color: "#0891b2", hasDraw: false, individual: false, pluralLabel: "ice hockey games" },
  baseball: { id: "baseball", name: "Baseball", slug: "baseball", icon: "⚾", color: "#dc2626", hasDraw: false, individual: false, pluralLabel: "baseball games" },
  "american-football": { id: "american-football", name: "American Football", slug: "american-football", icon: "🏈", color: "#7c3aed", hasDraw: false, individual: false, pluralLabel: "American football games" },
  rugby: { id: "rugby", name: "Rugby", slug: "rugby", icon: "🏉", color: "#be185d", hasDraw: true, individual: false, pluralLabel: "rugby matches" },
  volleyball: { id: "volleyball", name: "Volleyball", slug: "volleyball", icon: "🏐", color: "#2563eb", hasDraw: false, individual: false, pluralLabel: "volleyball matches" },
  handball: { id: "handball", name: "Handball", slug: "handball", icon: "🤾", color: "#4f46e5", hasDraw: true, individual: false, pluralLabel: "handball matches" },
};

export const SPORT_IDS = Object.keys(SPORTS) as SportId[];

export function isSportId(v: string): v is SportId {
  return v in SPORTS;
}

export function sportBySlug(slug: string): SportMeta | undefined {
  return SPORT_IDS.map((id) => SPORTS[id]).find((s) => s.slug === slug);
}

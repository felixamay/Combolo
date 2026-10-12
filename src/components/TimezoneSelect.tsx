"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function TimezoneSelect({ current, options }: { current: string; options: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  const all = options.includes(current) ? options : [current, ...options];
  return (
    <label className="flex items-center gap-1 text-xs muted">
      <span className="sr-only sm:not-sr-only">Time zone</span>
      <select
        className="field w-auto max-w-44 py-1"
        aria-label="Time zone"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          document.cookie = `combolo_tz=${encodeURIComponent(e.target.value)}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
      >
        {all.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

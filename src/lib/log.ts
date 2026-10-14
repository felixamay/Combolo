type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (meta !== undefined) fn(line, meta);
  else fn(line);
}

export const log = {
  debug: (m: string, meta?: unknown) => process.env.LOG_DEBUG && emit("debug", m, meta),
  info: (m: string, meta?: unknown) => emit("info", m, meta),
  warn: (m: string, meta?: unknown) => emit("warn", m, meta),
  error: (m: string, meta?: unknown) => emit("error", m, meta),
};

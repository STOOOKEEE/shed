// Leveled logger: one JSON object per line on stdout (journald / docker logs friendly).

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function write(level: LogLevel, msg: string, fields: LogFields): void {
  if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(minLevel)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  process.stdout.write(`${line}\n`);
}

/** Error → loggable fields (message only: stacks and causes stay out of public logs). */
export function errorFields(error: unknown): LogFields {
  return { error: error instanceof Error ? error.message : String(error) };
}

export const log = {
  debug: (msg: string, fields: LogFields = {}) => write("debug", msg, fields),
  info: (msg: string, fields: LogFields = {}) => write("info", msg, fields),
  warn: (msg: string, fields: LogFields = {}) => write("warn", msg, fields),
  error: (msg: string, fields: LogFields = {}) => write("error", msg, fields),
};

// `+07:00` body timestamps with six fraction digits (`mock-core.micros`) to milliseconds (V8 reads at most three fraction digits).
export function parseMicros(stamp: string): number {
  return Date.parse(stamp.replace(/(\.\d{3})\d*/, "$1"));
}

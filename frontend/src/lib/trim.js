const MIN_REMAINING = 1;

export function clampTrim(extent, trimStart, trimEnd) {
  const s = Math.max(0, Math.round(trimStart));
  const e = Math.max(0, Math.round(trimEnd));
  const cappedStart = Math.min(s, extent - MIN_REMAINING);
  const cappedEnd = Math.min(e, extent - MIN_REMAINING - cappedStart);
  return { trimStart: cappedStart, trimEnd: cappedEnd };
}

export function buildLayout(items, options) {
  return {
    direction: options.direction,
    spacing: Math.min(500, Math.max(0, Math.round(Number(options.spacing)) || 0)),
    background: options.background,
    items: items.map((it) => ({ trimStart: it.trimStart, trimEnd: it.trimEnd })),
    output:
      options.format === 'jpeg'
        ? { format: 'jpeg', quality: options.quality }
        : { format: 'png' },
  };
}

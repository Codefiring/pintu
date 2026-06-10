export function buildLayout(items, options) {
  return {
    direction: options.direction,
    spacing: options.spacing,
    background: options.background,
    items: items.map((it) => ({ trimStart: it.trimStart, trimEnd: it.trimEnd })),
    output:
      options.format === 'jpeg'
        ? { format: 'jpeg', quality: options.quality }
        : { format: 'png' },
  };
}

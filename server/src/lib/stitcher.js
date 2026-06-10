import sharp from 'sharp';

export const MAX_DIMENSION = 65000;

export class StitchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StitchError';
    this.code = code;
    Object.assign(this, details);
  }
}

const DEFAULT_OUTPUT = { format: 'png', quality: 90 };

export async function stitch(buffers, layout = {}) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new StitchError('INVALID_INPUT', 'at least one image is required');
  }

  const direction = layout.direction ?? 'vertical';
  const spacing = layout.spacing ?? 0;
  const background = layout.background ?? '#ffffff';
  const output = { ...DEFAULT_OUTPUT, ...layout.output };
  const items = layout.items ?? buffers.map(() => ({ trimStart: 0, trimEnd: 0 }));
  const vertical = direction === 'vertical';

  // Decode metadata and compute each image's extract region.
  const sources = [];
  for (let i = 0; i < buffers.length; i++) {
    let meta;
    try {
      meta = await sharp(buffers[i]).metadata();
    } catch {
      throw new StitchError('INVALID_IMAGE', `image ${i} could not be decoded`, { index: i });
    }
    const trimStart = items[i]?.trimStart ?? 0;
    const trimEnd = items[i]?.trimEnd ?? 0;
    const extent = vertical ? meta.height : meta.width;
    if (trimStart + trimEnd >= extent) {
      throw new StitchError('INVALID_TRIM', `image ${i} trimmed to nothing`, { index: i });
    }
    const region = vertical
      ? { left: 0, top: trimStart, width: meta.width, height: meta.height - trimStart - trimEnd }
      : { left: trimStart, top: 0, width: meta.width - trimStart - trimEnd, height: meta.height };
    sources.push({ buffer: buffers[i], region });
  }

  // Canvas size: cross-axis = max, main-axis = sum + spacing gaps.
  let width, height;
  if (vertical) {
    width = Math.max(...sources.map((s) => s.region.width));
    height =
      sources.reduce((sum, s) => sum + s.region.height, 0) + spacing * (sources.length - 1);
  } else {
    height = Math.max(...sources.map((s) => s.region.height));
    width =
      sources.reduce((sum, s) => sum + s.region.width, 0) + spacing * (sources.length - 1);
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new StitchError(
      'OUTPUT_TOO_LARGE',
      `output ${width}x${height} exceeds ${MAX_DIMENSION}px`,
      { width, height }
    );
  }

  // Place each trimmed image, centered on the cross axis.
  let offset = 0;
  const composites = [];
  for (const s of sources) {
    const input = await sharp(s.buffer).extract(s.region).toBuffer();
    composites.push(
      vertical
        ? { input, top: offset, left: Math.round((width - s.region.width) / 2) }
        : { input, top: Math.round((height - s.region.height) / 2), left: offset }
    );
    offset += (vertical ? s.region.height : s.region.width) + spacing;
  }

  let pipeline = sharp({ create: { width, height, channels: 3, background } }).composite(
    composites
  );
  pipeline =
    output.format === 'jpeg' ? pipeline.jpeg({ quality: output.quality }) : pipeline.png();

  const data = await pipeline.toBuffer();
  return { data, width, height, format: output.format };
}

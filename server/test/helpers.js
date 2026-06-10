import sharp from 'sharp';

export function solidImage(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

export async function pixelAt(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

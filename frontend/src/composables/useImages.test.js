import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useImages } from './useImages.js';

const fakeLoader = vi.fn(async () => ({ url: 'blob:fake', width: 100, height: 200 }));

function fakeFile(name, type = 'image/png', size = 1000) {
  return { name, type, size };
}

beforeEach(() => {
  globalThis.URL.revokeObjectURL = vi.fn();
  fakeLoader.mockClear();
});

describe('useImages', () => {
  it('adds image files with dimensions and zero trims', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const rejected = await addFiles([fakeFile('a.png'), fakeFile('b.png')]);

    expect(rejected).toEqual([]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ width: 100, height: 200, trimStart: 0, trimEnd: 0 });
    expect(items[0].id).not.toBe(items[1].id);
  });

  it('rejects non-images and oversize files with reasons', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const rejected = await addFiles([
      fakeFile('doc.pdf', 'application/pdf'),
      fakeFile('huge.png', 'image/png', 21 * 1024 * 1024),
      fakeFile('ok.png'),
    ]);

    expect(items).toHaveLength(1);
    expect(rejected).toEqual([
      { name: 'doc.pdf', reason: 'not_image' },
      { name: 'huge.png', reason: 'too_large' },
    ]);
  });

  it('rejects files beyond the 30-image cap', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const files = Array.from({ length: 31 }, (_, i) => fakeFile(`f${i}.png`));
    const rejected = await addFiles(files);

    expect(items).toHaveLength(30);
    expect(rejected).toEqual([{ name: 'f30.png', reason: 'too_many' }]);
  });

  it('moves an item to a new position', async () => {
    const { items, addFiles, move } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png'), fakeFile('b.png'), fakeFile('c.png')]);
    const [a, b, c] = items.map((it) => it.id);

    move(0, 2);

    expect(items.map((it) => it.id)).toEqual([b, c, a]);
  });

  it('removes an item and revokes its object URL', async () => {
    const { items, addFiles, remove } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png'), fakeFile('b.png')]);

    remove(items[0].id);

    expect(items).toHaveLength(1);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('clamps trims against the direction extent', async () => {
    const { items, addFiles, setTrim } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png')]); // 100w x 200h

    setTrim(items[0].id, 'vertical', { trimStart: 150, trimEnd: 100 });
    expect(items[0]).toMatchObject({ trimStart: 150, trimEnd: 49 }); // 200px extent

    setTrim(items[0].id, 'horizontal', { trimStart: 90, trimEnd: 50 });
    expect(items[0]).toMatchObject({ trimStart: 90, trimEnd: 9 }); // 100px extent
  });
});

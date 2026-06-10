import { reactive } from 'vue';
import { clampTrim } from '../lib/trim.js';

export const MAX_FILES = 30;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

let nextId = 1;

export function loadDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

export function useImages(dimensionLoader = loadDimensions) {
  const items = reactive([]);

  async function addFiles(files) {
    const rejected = [];
    for (const file of files) {
      if (items.length >= MAX_FILES) {
        rejected.push({ name: file.name, reason: 'too_many' });
        continue;
      }
      if (!file.type?.startsWith('image/')) {
        rejected.push({ name: file.name, reason: 'not_image' });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push({ name: file.name, reason: 'too_large' });
        continue;
      }
      try {
        const { url, width, height } = await dimensionLoader(file);
        items.push({ id: nextId++, file, url, width, height, trimStart: 0, trimEnd: 0 });
      } catch {
        rejected.push({ name: file.name, reason: 'not_image' });
      }
    }
    return rejected;
  }

  function remove(id) {
    const i = items.findIndex((it) => it.id === id);
    if (i === -1) return;
    URL.revokeObjectURL(items[i].url);
    items.splice(i, 1);
  }

  function move(from, to) {
    if (from === to) return;
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
  }

  function setTrim(id, direction, patch) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const extent = direction === 'vertical' ? it.height : it.width;
    Object.assign(
      it,
      clampTrim(extent, patch.trimStart ?? it.trimStart, patch.trimEnd ?? it.trimEnd)
    );
  }

  return { items, addFiles, remove, move, setTrim };
}

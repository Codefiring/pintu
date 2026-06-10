import { ref } from 'vue';
import { buildLayout } from '../lib/layout.js';

function messageFor(status, bodyText) {
  let body = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    // non-JSON error body; fall through to generic messages
  }
  if (status === 413 && body.error === 'OUTPUT_TOO_LARGE') {
    return `生成的图片过大（${body.width}×${body.height} 像素），请减少图片数量或改用 JPG`;
  }
  if (status === 413) return '上传内容过大，请减少图片数量或压缩图片';
  if (status === 422) return `第 ${Number(body.index ?? 0) + 1} 张图片无法处理，请移除后重试`;
  if (status === 400) return '请求参数有误，请刷新页面后重试';
  return '生成失败，请重试';
}

export function useStitchRequest() {
  const busy = ref(false);
  const progress = ref(0);
  const error = ref('');
  const resultUrl = ref('');
  const resultFormat = ref('png');

  function stitch(items, options) {
    busy.value = true;
    progress.value = 0;
    error.value = '';
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value);
      resultUrl.value = '';
    }

    const form = new FormData();
    for (const it of items) form.append('images', it.file, it.file.name);
    form.append('layout', JSON.stringify(buildLayout(items, options)));

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/stitch');
      xhr.responseType = 'blob';
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100);
      };
      xhr.onload = async () => {
        busy.value = false;
        if (xhr.status === 200) {
          resultUrl.value = URL.createObjectURL(xhr.response);
          resultFormat.value = options.format;
          resolve(true);
        } else {
          error.value = messageFor(xhr.status, await xhr.response.text());
          resolve(false);
        }
      };
      xhr.onerror = () => {
        busy.value = false;
        error.value = '网络错误，请检查连接后重试';
        resolve(false);
      };
      xhr.send(form);
    });
  }

  return { busy, progress, error, resultUrl, resultFormat, stitch };
}

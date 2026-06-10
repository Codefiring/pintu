<script setup>
import { reactive, computed, ref, watch } from 'vue';
import UploadZone from './components/UploadZone.vue';
import ImageList from './components/ImageList.vue';
import StitchPreview from './components/StitchPreview.vue';
import ExportPanel from './components/ExportPanel.vue';
import { useImages } from './composables/useImages.js';
import { useStitchRequest } from './composables/useStitchRequest.js';

const { items, addFiles, remove, move, setTrim } = useImages();
const { busy, progress, error, resultUrl, resultFormat, stitch } = useStitchRequest();

const options = reactive({
  direction: 'vertical',
  spacing: 0,
  background: '#ffffff',
  format: 'png',
  quality: 90,
});

watch(
  () => options.direction,
  () => {
    for (const it of items) {
      it.trimStart = 0;
      it.trimEnd = 0;
    }
  }
);

const toast = ref('');
const REASONS = {
  too_many: '超过 30 张上限',
  not_image: '不是有效图片',
  too_large: '文件过大，单张最大 20MB',
  total_too_large: '总大小超过 200MB 上限',
};

async function onFiles(files) {
  const rejected = await addFiles(files);
  if (rejected.length) {
    toast.value = rejected.map((r) => `${r.name}：${REASONS[r.reason]}`).join('；');
    setTimeout(() => (toast.value = ''), 5000);
  }
}

const canStitch = computed(() => items.length >= 2);
const downloadName = computed(() => `pintu.${resultFormat.value === 'jpeg' ? 'jpg' : 'png'}`);

function onTrim(id, patch) {
  setTrim(id, options.direction, patch);
}
</script>

<template>
  <header class="topbar">
    <h1>拼图 · 长图拼接</h1>
  </header>

  <main class="layout">
    <section class="work">
      <UploadZone @files="onFiles" />
      <p v-if="toast" class="toast">{{ toast }}</p>
      <ImageList
        :items="items"
        :direction="options.direction"
        @trim="onTrim"
        @remove="remove"
        @move="move"
      />
    </section>

    <aside class="side">
      <ExportPanel
        :options="options"
        :can-stitch="canStitch"
        :busy="busy"
        :progress="progress"
        :error="error"
        @stitch="stitch(items, options)"
      />
      <div v-if="resultUrl" class="result">
        <a class="download" :href="resultUrl" :download="downloadName">下载长图</a>
        <img :src="resultUrl" alt="拼接结果" />
      </div>
      <h2 v-if="items.length">预览</h2>
      <StitchPreview
        :items="items"
        :direction="options.direction"
        :spacing="options.spacing"
        :background="options.background"
      />
    </aside>
  </main>
</template>

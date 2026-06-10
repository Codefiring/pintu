<script setup>
import { ref } from 'vue';

const emit = defineEmits(['files']);
const dragging = ref(false);
const inputEl = ref(null);

function onDrop(e) {
  dragging.value = false;
  emit('files', [...e.dataTransfer.files]);
}

function onPick(e) {
  emit('files', [...e.target.files]);
  e.target.value = '';
}
</script>

<template>
  <div
    class="upload-zone"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
    @click="inputEl.click()"
  >
    <p class="main">点击或拖拽图片到此处</p>
    <p class="hint">最多 30 张，单张不超过 20MB</p>
    <input ref="inputEl" type="file" accept="image/*" multiple hidden @change="onPick" />
  </div>
</template>

<style scoped>
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  background: #fff;
  cursor: pointer;
}
.upload-zone.dragging {
  border-color: var(--accent);
  background: #eef3ff;
}
.main { margin: 0; font-size: 16px; }
.hint { margin: 8px 0 0; color: #888; font-size: 13px; }
</style>

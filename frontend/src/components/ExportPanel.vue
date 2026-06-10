<script setup>
defineProps({
  options: { type: Object, required: true }, // reactive; panel mutates its fields
  canStitch: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  error: { type: String, default: '' },
});
const emit = defineEmits(['stitch']);
</script>

<template>
  <div class="export-panel">
    <label>
      拼接方向
      <select v-model="options.direction">
        <option value="vertical">纵向</option>
        <option value="horizontal">横向</option>
      </select>
    </label>
    <label>
      间距 (px)
      <input type="number" min="0" max="500" v-model.number="options.spacing" />
    </label>
    <label>
      背景颜色
      <input type="color" v-model="options.background" />
    </label>
    <label>
      输出格式
      <select v-model="options.format">
        <option value="png">PNG</option>
        <option value="jpeg">JPG</option>
      </select>
    </label>
    <label v-if="options.format === 'jpeg'">
      质量 {{ options.quality }}
      <input type="range" min="1" max="100" v-model.number="options.quality" />
    </label>
    <button class="go" :disabled="!canStitch || busy" @click="emit('stitch')">
      {{ busy ? `上传中 ${progress}%` : '生成长图' }}
    </button>
    <p v-if="!canStitch" class="hint">请至少添加 2 张图片</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.export-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.go {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px;
  font-size: 15px;
}
.hint { margin: 0; color: #888; font-size: 12px; }
.error { margin: 0; color: var(--danger); font-size: 13px; }
</style>

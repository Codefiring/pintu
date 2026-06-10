<script setup>
import { computed } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  direction: { type: String, default: 'vertical' },
  spacing: { type: Number, default: 0 },
  background: { type: String, default: '#ffffff' },
});

const PREVIEW_EXTENT = 320; // displayed px across the stitch axis

const vertical = computed(() => props.direction === 'vertical');
const crossMax = computed(() =>
  Math.max(...props.items.map((it) => (vertical.value ? it.width : it.height)), 1)
);
const k = computed(() => PREVIEW_EXTENT / crossMax.value);

function pieceStyle(it) {
  const main = (vertical.value ? it.height : it.width) - it.trimStart - it.trimEnd;
  return vertical.value
    ? { width: `${it.width * k.value}px`, height: `${main * k.value}px` }
    : { width: `${main * k.value}px`, height: `${it.height * k.value}px` };
}

function imgStyle(it) {
  return vertical.value
    ? { width: `${it.width * k.value}px`, marginTop: `${-it.trimStart * k.value}px` }
    : { height: `${it.height * k.value}px`, marginLeft: `${-it.trimStart * k.value}px` };
}

const containerStyle = computed(() => ({
  background: props.background,
  gap: `${props.spacing * k.value}px`,
  flexDirection: vertical.value ? 'column' : 'row',
}));
</script>

<template>
  <div v-if="items.length" class="stitch-preview" :style="containerStyle">
    <div v-for="it in items" :key="it.id" class="piece" :style="pieceStyle(it)">
      <img :src="it.url" :style="imgStyle(it)" draggable="false" />
    </div>
  </div>
</template>

<style scoped>
.stitch-preview {
  display: flex;
  align-items: center;
  width: fit-content;
  border: 1px solid var(--border);
}
.piece {
  overflow: hidden;
  flex: none;
}
.piece img {
  display: block;
}
</style>

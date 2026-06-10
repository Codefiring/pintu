<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  item: { type: Object, required: true },
  direction: { type: String, default: 'vertical' },
});
const emit = defineEmits(['trim', 'remove']);

const thumbEl = ref(null);
const vertical = computed(() => props.direction === 'vertical');
const extent = computed(() => (vertical.value ? props.item.height : props.item.width));

function naturalPerDisplayedPx() {
  const el = thumbEl.value;
  const displayed = vertical.value ? el.clientHeight : el.clientWidth;
  return extent.value / displayed;
}

function startDrag(edge, e) {
  e.preventDefault();
  e.stopPropagation();
  const startPos = vertical.value ? e.clientY : e.clientX;
  const startTrim = props.item[edge];
  const k = naturalPerDisplayedPx();
  const onMove = (ev) => {
    const pos = vertical.value ? ev.clientY : ev.clientX;
    const delta = (pos - startPos) * (edge === 'trimStart' ? 1 : -1);
    emit('trim', props.item.id, { [edge]: startTrim + Math.round(delta * k) });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

const startPct = computed(() => `${(props.item.trimStart / extent.value) * 100}%`);
const endPct = computed(() => `${(props.item.trimEnd / extent.value) * 100}%`);

const shadeStartStyle = computed(() =>
  vertical.value
    ? { top: 0, left: 0, right: 0, height: startPct.value }
    : { top: 0, bottom: 0, left: 0, width: startPct.value }
);
const shadeEndStyle = computed(() =>
  vertical.value
    ? { bottom: 0, left: 0, right: 0, height: endPct.value }
    : { top: 0, bottom: 0, right: 0, width: endPct.value }
);
const handleStartStyle = computed(() =>
  vertical.value ? { top: startPct.value, left: 0, right: 0 } : { left: startPct.value, top: 0, bottom: 0 }
);
const handleEndStyle = computed(() =>
  vertical.value ? { bottom: endPct.value, left: 0, right: 0 } : { right: endPct.value, top: 0, bottom: 0 }
);
</script>

<template>
  <div class="image-card">
    <div ref="thumbEl" class="thumb">
      <img :src="item.url" :alt="item.file.name" draggable="false" />
      <div class="shade" :style="shadeStartStyle"></div>
      <div class="shade" :style="shadeEndStyle"></div>
      <div
        class="handle"
        :class="vertical ? 'v' : 'h'"
        :style="handleStartStyle"
        @pointerdown="startDrag('trimStart', $event)"
        @dragstart.prevent.stop
      ></div>
      <div
        class="handle"
        :class="vertical ? 'v' : 'h'"
        :style="handleEndStyle"
        @pointerdown="startDrag('trimEnd', $event)"
        @dragstart.prevent.stop
      ></div>
    </div>
    <div class="meta">
      <span class="name" :title="item.file.name">{{ item.file.name }}</span>
      <button class="remove" title="移除" @click="emit('remove', item.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.thumb {
  position: relative;
  line-height: 0;
}
.thumb img {
  width: 100%;
  display: block;
}
.shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.handle {
  position: absolute;
  background: var(--accent);
  opacity: 0.85;
  touch-action: none;
}
.handle.v { height: 8px; cursor: ns-resize; }
.handle.h { width: 8px; cursor: ew-resize; }
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  border: none;
  background: none;
  color: var(--danger);
  font-size: 14px;
  padding: 0 4px;
}
</style>

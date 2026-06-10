<script setup>
import { ref } from 'vue';
import ImageCard from './ImageCard.vue';

defineProps({
  items: { type: Array, required: true },
  direction: { type: String, default: 'vertical' },
});
const emit = defineEmits(['trim', 'remove', 'move']);

const dragFrom = ref(null);

function onDragStart(i) {
  dragFrom.value = i;
}
function onDrop(i) {
  if (dragFrom.value !== null && dragFrom.value !== i) emit('move', dragFrom.value, i);
  dragFrom.value = null;
}
</script>

<template>
  <div class="image-list">
    <div
      v-for="(item, i) in items"
      :key="item.id"
      class="slot"
      draggable="true"
      @dragstart="onDragStart(i)"
      @dragover.prevent
      @drop.prevent="onDrop(i)"
    >
      <span class="order">{{ i + 1 }}</span>
      <ImageCard
        :item="item"
        :direction="direction"
        @trim="(id, patch) => emit('trim', id, patch)"
        @remove="(id) => emit('remove', id)"
      />
    </div>
  </div>
</template>

<style scoped>
.image-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.slot {
  position: relative;
  cursor: grab;
}
.order {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 1;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

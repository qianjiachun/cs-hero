<script setup lang="ts">
import { computed, useAttrs } from 'vue'

/** 侧栏圆角外壳（与 header 区分的面板壳，非内容区内独立卡片） */
const props = withDefaults(
  defineProps<{
    as?: 'aside' | 'div'
  }>(),
  {
    as: 'aside'
  }
)

defineOptions({
  inheritAttrs: false
})

const attrs = useAttrs()
const tag = computed(() => props.as)
</script>

<template>
  <component :is="tag" class="app-shell" v-bind="attrs">
    <slot />
  </component>
</template>

<style scoped>
.app-shell {
  flex-shrink: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 16px 10px;
  border-radius: var(--radius-panel);
  background-color: var(--bg-sidebar);
}
</style>

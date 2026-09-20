<script setup lang="ts">
 /**
 * BoardSkeleton：看板水合骨架屏（纯展示，无 props / emits）。
 *
 * 本地任务状态从服务端水合期间占位，避免看板闪现空态。
 * 结构与真实泳道一致（4 列 + 每列 3 张卡片占位），仅用静态灰块表达。
 */
</script>

<template>
  <div class="flex gap-4.5 h-full min-w-max items-start" role="status" aria-label="看板加载中">
    <section
      v-for="n in 4"
      :key="n"
      class="flex flex-col max-h-full p-3 rounded-2xl flex-none w-[310px] gap-3 animate-pulse"
      :style="{ background: 'var(--fill-faint)', border: '1px solid var(--border)' }"
    >
      <div class="flex items-center gap-2 pb-1">
        <div class="w-2 h-2 rounded-full" style="background: var(--border-strong)" />
        <div class="h-3.5 w-16 rounded" style="background: var(--border-strong)" />
        <div class="h-4 w-5 rounded-full ml-auto" style="background: var(--border-strong)" />
      </div>
      <div class="h-20 rounded-xl" style="background: var(--card)" />
      <div class="h-20 rounded-xl" style="background: var(--card)" />
      <div class="h-14 rounded-xl" style="background: var(--card)" />
    </section>
  </div>
</template>

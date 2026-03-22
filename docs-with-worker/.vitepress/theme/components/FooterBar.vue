<template>
  <footer class="pa-footer">
    <span>PROTOAGENT//DOCS v0.0.1</span>
  </footer>
</template>

<style scoped>
.pa-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 28px;
  border-top: 1px solid var(--border-strong);
  background: rgba(4, 9, 6, 0.94);
  backdrop-filter: blur(10px);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--text-xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

@media (max-width: 1180px) {
  .pa-footer {
    padding-left: 24px;
    padding-right: 24px;
    font-size: calc(var(--text-xs) - 0.07rem);
    letter-spacing: 0.12em;
  }
}
</style>

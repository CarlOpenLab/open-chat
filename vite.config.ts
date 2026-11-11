import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: { ignorePatterns: ["vendor/**"] },
  lint: {
    ignorePatterns: ["vendor/**"],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    globals: true,
    // vendor 是独立仓库（自带 node:test 套件）；.claude 下是本仓库的 worktree 副本，
    // 两者都不属于本项目的 vitest 测试范围，避免重复/错误收集。
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "vendor/**"],
  },
});

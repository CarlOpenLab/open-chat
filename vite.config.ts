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
  test: { globals: true },
});

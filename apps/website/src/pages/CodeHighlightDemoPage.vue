<script setup lang="ts">
import { CodeHighlighter } from "@antdv-next/x";
import { Moon, Sun } from "@lucide/vue";
import { ref } from "vue";

const samples: { language: string; code: string }[] = [
  {
    language: "go",
    code: `package main\n\nimport "fmt"\n\nfunc main() {\n    nums := []int{1, 2, 3}\n    fmt.Println(nums)\n}`,
  },
  {
    language: "rust",
    code: `fn main() {\n    let xs = vec![1, 2, 3];\n    let sum: i32 = xs.iter().sum();\n    println!("sum = {}", sum);\n}`,
  },
  {
    language: "java",
    code: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Java!");\n    }\n}`,
  },
  {
    language: "c",
    code: `#include <stdio.h>\n\nint main(void) {\n    printf("Hello, C!\\n");\n    return 0;\n}`,
  },
  {
    language: "cpp",
    code: `#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> v{1, 2, 3};\n    for (auto x : v) std::cout << x << ' ';\n}`,
  },
  {
    language: "csharp",
    code: `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, C#!");\n    }\n}`,
  },
  {
    language: "php",
    code: `<?php\nfunction add($a, $b) {\n    return $a + $b;\n}\necho add(1, 2);`,
  },
  {
    language: "ruby",
    code: `class Greeter\n  def initialize(name)\n    @name = name\n  end\n\n  def greet = "Hello, #{@name}!"\nend`,
  },
  {
    language: "sql",
    code: `SELECT id, name, created_at\nFROM users\nWHERE active = true\nORDER BY created_at DESC\nLIMIT 10;`,
  },
  {
    language: "scss",
    code: `$primary: #1677ff;\n\n.button {\n  color: $primary;\n  &:hover { opacity: .8; }\n  &--block { display: block; width: 100%; }\n}`,
  },
  {
    language: "dockerfile",
    code: `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci --omit=dev\nCMD ["node", "server.js"]`,
  },
  {
    language: "toml",
    code: `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"`,
  },
  {
    language: "ini",
    code: `[server]\nhost = 127.0.0.1\nport = 8080\ndebug = true\n\n[cache]\nttl = 300`,
  },
  {
    language: "graphql",
    code: `type Query {\n  user(id: ID!): User\n}\n\ntype User {\n  id: ID!\n  name: String!\n  role: Role!\n}`,
  },
  {
    language: "xml",
    code: `<?xml version="1.0" encoding="UTF-8"?>\n<note>\n  <to>Carl</to>\n  <from>Bot</from>\n  <body>Don't forget the demo</body>\n</note>`,
  },
  {
    language: "regex",
    code: `/\\b[A-Z][a-z]+\\b/g\n# match capitalized words\n/\\d{3}-\\d{4}/g\n# phone like 123-4567`,
  },
];

const theme = ref<"light" | "dark">("dark");
const toggleTheme = () => (theme.value = theme.value === "dark" ? "light" : "dark");
</script>

<template>
  <main id="code-highlight-demo" class="mx-auto min-h-[100dvh] w-full max-w-4xl px-5 py-8">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">动态语言高亮 Demo</h1>
        <p class="mt-1 text-sm opacity-70">
          使用 setupCodeHighlighter 按需加载 Shiki grammar · 共 {{ samples.length }} 种语言
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:opacity-80"
        @click="toggleTheme"
      >
        <component :is="theme === 'dark' ? Sun : Moon" class="h-4 w-4" />
        {{ theme === "dark" ? "浅色" : "深色" }}
      </button>
    </header>

    <div class="flex flex-col gap-5">
      <CodeHighlighter
        v-for="sample in samples"
        :key="sample.language"
        :content="sample.code"
        :language="sample.language"
        :theme="theme"
      />
    </div>
  </main>
</template>

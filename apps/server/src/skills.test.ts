/// <reference types="vite-plus/test/globals" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeSkillCollections,
  parseFrontmatter,
  readSkillsFromRoots,
  SKILL_ROOTS,
} from "./skills";

describe("skills scanner", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "open-chat-skills-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("scans project and global roots and lets project override global by name", async () => {
    writeSkill(join(directory, "project", ".claude/skills/review"), {
      name: "review",
      description: "复审当前变更",
    });
    writeSkill(join(directory, "project", ".agents/skills/deploy"), {
      description: "执行部署流程",
    });
    writeSkill(join(directory, "home", ".claude/skills/review"), {
      name: "review",
      description: "全局复审",
    });
    writeSkill(join(directory, "home", ".agents/skills/notes"), {
      name: "notes",
      description: "整理笔记",
    });

    const { project, global } = await readSkillsFromRoots([
      { base: join(directory, "project"), source: "project" },
      { base: join(directory, "home"), source: "global" },
    ]);
    const merged = mergeSkillCollections({ project, global });

    // 合并后按名字排序；全局 review 与项目同名，应被项目覆盖
    expect(merged.project.map((skill) => skill.name)).toEqual(["deploy", "review"]);
    expect(merged.global.map((skill) => skill.name)).toEqual(["notes"]);
    expect(merged.project.find((skill) => skill.name === "review")).toMatchObject({
      description: "复审当前变更",
      source: "project",
      scope: ".claude/skills",
    });
    // 无 frontmatter name 时回退目录名
    expect(merged.project.find((skill) => skill.name === "deploy")).toMatchObject({
      description: "执行部署流程",
      source: "project",
    });
  });

  it("falls back to the first heading and tolerates missing or broken directories", async () => {
    writeSkill(join(directory, ".agents/skills/fallback"), { title: "回退标题" });
    mkdirSync(join(directory, "empty", ".claude/skills"), { recursive: true });
    mkdirSync(join(directory, "missing-file", ".claude/skills/orphan"), { recursive: true });

    const { project, global } = await readSkillsFromRoots([
      { base: directory, source: "project" },
      { base: join(directory, "no-such-dir"), source: "global" },
    ]);

    expect(project.map((skill) => skill.name)).toEqual(["fallback"]);
    expect(project[0].description).toBe("回退标题");
    expect(project[0].scope).toBe(".agents/skills");
    expect(global).toEqual([]);
  });

  it("ignores hidden directories and plain files inside skill roots", async () => {
    writeSkill(join(directory, ".hidden"), { name: "hidden", description: "应被忽略" });
    writeFileSync(join(directory, "loose.md"), "# 顶层文件不算 skill\n");

    const { project } = await readSkillsFromRoots([{ base: directory, source: "project" }]);
    expect(project).toEqual([]);
  });

  it("parses frontmatter name and description with quote stripping", () => {
    expect(
      parseFrontmatter('---\nname: "my-skill"\ndescription:  处理数据  \n---\n\n# 正文\n'),
    ).toEqual({ name: "my-skill", description: "处理数据" });
    expect(parseFrontmatter("没有 frontmatter")).toEqual({});
    expect(parseFrontmatter("---\nname: 未闭合\n")).toEqual({});
  });
});

function writeSkill(
  skillDir: string,
  meta: { name?: string; description?: string; title?: string },
) {
  mkdirSync(skillDir, { recursive: true });
  const lines = ["---"];
  if (meta.name) lines.push(`name: ${meta.name}`);
  if (meta.description) lines.push(`description: ${meta.description}`);
  if (meta.name || meta.description) lines.push("---", "");
  if (meta.title) lines.push(`# ${meta.title}`);
  writeFileSync(join(skillDir, "SKILL.md"), `${lines.join("\n")}\n`);
}

// SKILL_ROOTS 常量被 app 路由与扫描共用，锁定数量防止误删
describe("SKILL_ROOTS", () => {
  it("covers the standard CLI skill directories", () => {
    expect(SKILL_ROOTS).toContain(".claude/skills");
    expect(SKILL_ROOTS).toContain(".agents/skills");
  });
});

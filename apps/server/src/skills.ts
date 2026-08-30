/**
 * 扫描项目 / 全局 skills 目录，供输入区 "/" suggestion 展示。
 *
 * 约定与主流 CLI（Claude Code / Codex / Pi / omp 等）一致：
 * skills 根目录下的每个包含 SKILL.md 的子目录视为一个 skill，
 * 元数据（name / description）取 SKILL.md 的 frontmatter。
 */

import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkillSummary {
  name: string;
  description: string;
  source: "project" | "global";
  /** 所在 skills 根目录（相对项目目录或 home），如 .claude/skills */
  scope: string;
}

export interface SkillsIndex {
  project: SkillSummary[];
  global: SkillSummary[];
}

/** 常见 CLI 的 skills 根目录约定（相对项目目录 / 用户 home，两者共用同一组）。 */
export const SKILL_ROOTS = [
  ".claude/skills",
  ".agents/skills",
  ".codex/skills",
  ".pi/skills",
  ".omp/skills",
] as const;

/** 单个 skills 根目录的条目上限，防止异常目录拖垮接口。 */
const MAX_SKILLS_PER_ROOT = 100;

export async function listSkills(projectPath = ""): Promise<SkillsIndex> {
  const roots: Array<{ base: string; source: SkillSummary["source"] }> = [];
  const project = projectPath.trim();
  if (project) roots.push({ base: project, source: "project" });
  roots.push({ base: homedir(), source: "global" });
  return mergeSkillCollections(await readSkillsFromRoots(roots));
}

/** 合并两个作用域：组内按名字去重并排序，全局再剔除与项目同名的条目（与 CLI 加载优先级一致）。 */
export function mergeSkillCollections(collected: SkillsIndex): SkillsIndex {
  const projectNames = new Set(collected.project.map((skill) => skill.name.toLowerCase()));
  return {
    project: dedupeByName(collected.project).sort(byName),
    global: dedupeByName(collected.global)
      .filter((skill) => !projectNames.has(skill.name.toLowerCase()))
      .sort(byName),
  };
}

function byName(left: SkillSummary, right: SkillSummary): number {
  return left.name.localeCompare(right.name);
}

/** 供测试注入临时目录；按 roots 顺序扫描，供同名去重时保持优先级。 */
export async function readSkillsFromRoots(
  roots: Array<{ base: string; source: SkillSummary["source"] }>,
): Promise<{ project: SkillSummary[]; global: SkillSummary[] }> {
  const result: { project: SkillSummary[]; global: SkillSummary[] } = {
    project: [],
    global: [],
  };
  await Promise.all(
    roots.map(async ({ base, source }) => {
      const skills = await Promise.all(
        SKILL_ROOTS.map((root) => scanSkillRoot(base, root, source)),
      );
      result[source].push(...skills.flat());
    }),
  );
  return result;
}

async function scanSkillRoot(
  base: string,
  root: string,
  source: SkillSummary["source"],
): Promise<SkillSummary[]> {
  const dir = join(base, root);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_SKILLS_PER_ROOT);
  const skills = await Promise.all(
    dirs.map(async (name) => {
      const summary = await readSkillSummary(join(dir, name, "SKILL.md"), name, source, root);
      return summary;
    }),
  );
  return skills.filter((skill): skill is SkillSummary => skill !== null);
}

/** 读取并解析单个 SKILL.md；文件缺失或为空时返回 null。 */
async function readSkillSummary(
  file: string,
  fallbackName: string,
  source: SkillSummary["source"],
  scope: string,
): Promise<SkillSummary | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  const frontmatter = parseFrontmatter(raw);
  const name = frontmatter.name?.trim() || fallbackName;
  const description =
    frontmatter.description?.trim() || firstHeading(stripFrontmatter(raw)) || fallbackName;
  return { name, description, source, scope };
}

/** 解析 SKILL.md 顶部 `---` 包裹的 frontmatter，只取顶层 name / description 单行值。 */
export function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = text.slice(4, end);
  const result: { name?: string; description?: string } = {};
  for (const line of block.split("\n")) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (match[1] === "name") result.name = value;
    else result.description = value;
  }
  return result;
}

function stripFrontmatter(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  const nextLine = text.indexOf("\n", end + 1);
  return nextLine === -1 ? "" : text.slice(nextLine + 1);
}

function firstHeading(body: string): string {
  const match = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
  return match ? match[1].trim() : "";
}

function dedupeByName(skills: SkillSummary[]): SkillSummary[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

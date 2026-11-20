import { Icon, addCollection, type IconifyJSON } from "@iconify/vue";
import rawCatppuccin from "@iconify-json/catppuccin/icons.json";
import { h, type VNode } from "vue";

const collection = rawCatppuccin as unknown as IconifyJSON;
addCollection(collection);

function resolveName(candidates: string[], fallback = "file"): string {
  const icons = collection.icons ?? {};
  const aliases = collection.aliases ?? {};
  for (const name of candidates) {
    if (name in icons || name in aliases) return name;
  }
  return fallback in icons || fallback in aliases ? fallback : Object.keys(icons)[0] || fallback;
}

const iconCache = new Map<string, () => VNode>();

function icon(...candidates: string[]): () => VNode {
  const key = `${collection.prefix}:${resolveName(candidates)}`;
  let fn = iconCache.get(key);
  if (!fn) {
    fn = () => h(Icon, { icon: key, width: 15, height: 15, class: "ws-file-icon" });
    iconCache.set(key, fn);
  }
  return fn;
}

const tsIcon = icon("typescript");
const jsIcon = icon("javascript");
const tsxIcon = icon("typescript-react", "react-ts", "typescript");
const jsxIcon = icon("javascript-react", "react", "javascript");
const vueIcon = icon("vue");
const svelteIcon = icon("svelte");
const astroIcon = icon("astro");
const htmlIcon = icon("html");
const cssIcon = icon("css");
const sassIcon = icon("sass", "css");
const lessIcon = icon("less", "css");
const goIcon = icon("go");
const goModIcon = icon("go-mod", "go");
const pyIcon = icon("python");
const rsIcon = icon("rust");
const javaIcon = icon("java");
const ktIcon = icon("kotlin");
const swiftIcon = icon("swift");
const cIcon = icon("c");
const hIcon = icon("c-header", "h", "c");
const cppIcon = icon("cpp");
const hppIcon = icon("cpp-header", "hpp", "cpp");
const csIcon = icon("csharp");
const rbIcon = icon("ruby");
const phpIcon = icon("php");
const luaIcon = icon("lua");
const dartIcon = icon("dart");
const zigIcon = icon("zig");
const jsonIcon = icon("json");
const yamlIcon = icon("yaml");
const tomlIcon = icon("toml");
const xmlIcon = icon("xml");
const cfgIcon = icon("config", "properties", "settings");
const envIcon = icon("env", "config");
const lockIcon = icon("lock");
const mdIcon = icon("markdown");
const mdxIcon = icon("markdown-mdx", "mdx", "markdown");
const txtIcon = icon("text", "file");
const logIcon = icon("log", "text", "file");
const pdfIcon = icon("pdf");
const tableIcon = icon("csv", "spreadsheet", "table");
const shIcon = icon("bash", "shell", "console");
const batIcon = icon("batch", "bash", "console");
const psIcon = icon("powershell", "bash", "console");
const dockerIcon = icon("docker");
const gitIcon = icon("git");
const diffIcon = icon("diff", "git");
const sqlIcon = icon("database");
const gqlIcon = icon("graphql");
const protoIcon = icon("proto");
const prismaIcon = icon("prisma");
const svgIcon = icon("svg", "image");
const imgIcon = icon("image");
const videoIcon = icon("video");
const audioIcon = icon("audio");
const zipIcon = icon("archive", "zip");

/**
 * Offline Catppuccin (Zed-style pastel) icon map for `@antdv-next/x` Folder.
 */
export const directoryIcons: Record<string, () => VNode> = {
  directory: icon("folder", "folder-src"),
  ts: tsIcon,
  mts: tsIcon,
  cts: tsIcon,
  tsx: tsxIcon,
  js: jsIcon,
  mjs: jsIcon,
  cjs: jsIcon,
  jsx: jsxIcon,
  vue: vueIcon,
  svelte: svelteIcon,
  astro: astroIcon,
  html: htmlIcon,
  htm: htmlIcon,
  css: cssIcon,
  scss: sassIcon,
  sass: sassIcon,
  less: lessIcon,
  go: goIcon,
  mod: goModIcon,
  sum: goModIcon,
  py: pyIcon,
  rs: rsIcon,
  java: javaIcon,
  kt: ktIcon,
  kts: ktIcon,
  swift: swiftIcon,
  c: cIcon,
  h: hIcon,
  cpp: cppIcon,
  cc: cppIcon,
  cxx: cppIcon,
  hpp: hppIcon,
  cs: csIcon,
  rb: rbIcon,
  php: phpIcon,
  lua: luaIcon,
  dart: dartIcon,
  zig: zigIcon,
  json: jsonIcon,
  jsonc: jsonIcon,
  json5: jsonIcon,
  yaml: yamlIcon,
  yml: yamlIcon,
  toml: tomlIcon,
  xml: xmlIcon,
  plist: xmlIcon,
  ini: cfgIcon,
  conf: cfgIcon,
  cfg: cfgIcon,
  env: envIcon,
  lock: lockIcon,
  md: mdIcon,
  markdown: mdIcon,
  mdx: mdxIcon,
  txt: txtIcon,
  log: logIcon,
  pdf: pdfIcon,
  csv: tableIcon,
  tsv: tableIcon,
  xlsx: tableIcon,
  sh: shIcon,
  bash: shIcon,
  zsh: shIcon,
  fish: shIcon,
  bat: batIcon,
  cmd: batIcon,
  ps1: psIcon,
  dockerfile: dockerIcon,
  dockerignore: dockerIcon,
  gitignore: gitIcon,
  gitattributes: gitIcon,
  diff: diffIcon,
  patch: diffIcon,
  sql: sqlIcon,
  sqlite: sqlIcon,
  db: sqlIcon,
  graphql: gqlIcon,
  gql: gqlIcon,
  proto: protoIcon,
  prisma: prismaIcon,
  svg: svgIcon,
  png: imgIcon,
  jpg: imgIcon,
  jpeg: imgIcon,
  gif: imgIcon,
  webp: imgIcon,
  ico: imgIcon,
  icns: imgIcon,
  mp4: videoIcon,
  mov: videoIcon,
  webm: videoIcon,
  mp3: audioIcon,
  wav: audioIcon,
  zip: zipIcon,
  tar: zipIcon,
  gz: zipIcon,
  "7z": zipIcon,
};

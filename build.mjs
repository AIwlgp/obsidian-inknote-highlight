// 构建脚本：把 src/main.js 打包成 Obsidian 可直接加载的 main.js，
// 并生成「发布包」文件夹 dist/<plugin-id>/（只含 Obsidian 需要的文件）。
// 用法：node build.mjs（或 npm run build）
// 以后每次更新只需 npm run build，发布包会自动同步到该文件夹。
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

// Obsidian 插件发布所需的文件及其目标文件名（来源文件名 → 目标）
const PLUGIN_ID = "inknote-highlight";
const DIST_DIR = path.join("dist", PLUGIN_ID);
const RELEASE_FILES = [
  "manifest.json", // 插件清单（id / 版本 / 名称等，Obsidian 必需）
  "main.js",       // 打包后的插件入口（Obsidian 必需）
  "styles.css",    // 备用样式 + 阅读模式表格表头配色（可选）
];

await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  outfile: "main.js",
  external: ["obsidian", "@codemirror/view", "electron"],
  legalComments: "inline",
});

// 生成发布包：只收集 Obsidian 需要的文件，源码/脚本/依赖/备份一律不进包
fs.mkdirSync(DIST_DIR, { recursive: true });
for (const file of RELEASE_FILES) {
  if (!fs.existsSync(file)) {
    console.error(`❌ 缺少发布所需文件：${file}（请确认已构建）`);
    process.exit(1);
  }
  fs.copyFileSync(file, path.join(DIST_DIR, file));
}

console.log("✅ 构建完成 → main.js");
console.log(`✅ 发布包 → ${DIST_DIR}/`);
console.log("   包含：" + RELEASE_FILES.join(" + "));
console.log("   将该文件夹复制到 .obsidian/plugins/ 下即可安装。");

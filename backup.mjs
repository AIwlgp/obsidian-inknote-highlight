// 滚动备份：main.js + 两个备份（main.bak1.js 上一版 / main.bak2.js 更早一版）
// 用法：每个版本改动前运行 node backup.mjs（或 npm run backup）
// 轮换规则：主文件被新版本修改时，旧版依次后移，最旧备份被替换
//   bak2 ← bak1（最旧备份被替换）
//   bak1 ← main（当前版本入备份链，成为最新备份）
// 改完构建后：main.js = 新版，两个备份各存前两版
import fs from "node:fs";

const MAIN = "main.js";
const B1 = "main.bak1.js"; // 最新备份（上一版）
const B2 = "main.bak2.js"; // 最旧备份（上上版）

if (!fs.existsSync(MAIN)) {
  console.error("❌ 未找到 main.js，请先构建（npm run build）");
  process.exit(1);
}

if (fs.existsSync(B1)) fs.copyFileSync(B1, B2);
fs.copyFileSync(MAIN, B1);

console.log("✅ 备份轮换完成：");
console.log(`   main.js        → 最新版（待修改）`);
console.log(`   main.bak1.js   → 上一版备份`);
console.log(`   main.bak2.js   → 更早一版备份`);

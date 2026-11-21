# 墨记中文结构高亮 v2（inknote-highlight）

> Structured syntax highlighting for **Chinese** notes in Obsidian: chapter headings, 《book titles》, 「quotes」, meta key–value pairs, ordinals, dates and links each get their own color, layered by a "strict innermost wins" rule. Desktop only.

一个 Obsidian 插件，为**中文结构化笔记**（小说、书籍、阅读笔记等）提供基于正则的结构化语法高亮。核心思路是「一张正则规则表 + 严格最内层嵌套染色」，并覆盖 Obsidian 默认的 Markdown 染色。

## 功能

高亮规则覆盖两类场景，按「最内层必胜」和「属性叠加」的原则配色：

**行级（整行语义）**

- `第X卷` / `第X回/章/节` 行（章节标题）
- 数字小节标题（`1 引言`）与固定小标题（`简介`、`序`、`前言`、`附录` 等）
- `文本：文本` 的 meta 键值对（`作者：鲁迅`）
- 分隔线、标题（`#` 层级递进色）、块引用（`>`）、斜体标注行（`*设计原理：…`）
- 列表 / 任务清单 / 有序列表标记、中文序号（`一、` `（一）`）

**行内（内容片段）**

- 书名号 `《》`、引号 `「」` `『』` `“”`
- 参考文献 `[1]`、圆圈序号 `①②`、纯数字括号 `（1961）`、中文括号配对 `（）`
- 日期 / 时间（整体一色，不被内部数字打碎）
- 数字、数字+单位（`1970s`、`7.83Hz`）、英文/拉丁标识符
- 流程箭头 `→`、破折号 `——`
- Markdown 标记：粗体 `**`、删除线 `~~`、行内代码 `` ` ``（标记字符本身不染色）
- 链接 / Wiki 链接 / 图片 / 裸 URL（裸 URL 整体一色，内部不被数字/英文拆散）
- 代码围栏（``` / ~~~）整体跳过，不予染色；管道表格表头按 meta 色渲染

## 安装

> 插件同时提供**阅读模式**（Markdown PostProcessor）与**编辑模式**（CodeMirror ViewPlugin）高亮。

**手动安装（推荐）**

1. 将本项目目录放入 Obsidian 库的 `.obsidian/plugins/inknote-highlight/`。
2. 确认目录内有 `main.js`、`manifest.json`、`styles.css`（`main.js` 为 `npm run build` 的产物）。
3. 在「设置 → 第三方插件」中启用「墨记中文结构高亮」。

**从源码构建**

```bash
npm install
npm run build      # 打包 src/main.js → main.js，并生成发布包 dist/inknote-highlight/
```

`npm run build` 会同时生成**发布包** `dist/inknote-highlight/`，里面只包含 Obsidian 需要的三个文件：
`manifest.json`、`main.js`、`styles.css`。把这个 `inknote-highlight` 文件夹整体复制到
Obsidian 库的 `.obsidian/plugins/` 下即可安装。以后每次更新只需重新 `npm run build`，
发布包会自动同步。

> 需要 **Obsidian 1.5.0 或更高版本**；当前仅支持桌面端（`isDesktopOnly: true`，移动端未验证）。

## 使用

无需配置，开启插件即生效。高亮颜色区分亮色/暗色主题，切换主题后编辑模式会即时刷新配色。

## 配色与规则自定义

颜色在 `src/main.js` 顶部的 `THEMES`（`light` / `dark`）中定义；正则规则表在 `buildRules()` 中，每条规则为：

```js
{
  name: "book",
  re: /《[^《》\n]{1,60}》/g,          // 正则
  style: { color: t.book },          // 样式对象，或 (match, theme) => style
  group: 0,                          // 可选：染色的捕获组号（默认 0 = 整段）
  atomic: true,                      // 可选：整段为原子单元，屏蔽内部嵌套染色
  priority: 0,                       // 可选：完全同区间的规则间决胜（内容规则 > 包裹规则）
}
```

修改后重新 `npm run build` 即可。

## 代码结构

| 路径 | 作用 |
| --- | --- |
| `src/main.js` | 插件源码（规则表、容器检测、span 合成器、阅读/编辑双入口） |
| `main.js` | 构建产物（由 esbuild 从 `src/main.js` 生成） |
| `manifest.json` | Obsidian 插件清单（id / 版本 / 最低应用版本） |
| `styles.css` | 备用样式层 + 阅读模式表格表头配色 |
| `build.mjs` | 构建脚本（`npm run build`，打包并生成发布包 `dist/`） |
| `backup.mjs` | 构建产物备份轮换脚本（`npm run backup`） |
| `dist/inknote-highlight/` | **发布文件夹**：只含 Obsidian 需要的 `manifest.json + main.js + styles.css`，可直接复制到 `.obsidian/plugins/` |

## 版本

- **v2.0.5**：修复「URL 里的冒号被当作 meta 键」（`https://...` 之后的正文被误染成 metaValue，meta 键收紧为纯中文）；编辑模式给容器扫描（代码围栏/表格）加了按文本缓存，滚动视口、切换主题时不再每帧全篇重扫。
- **v2.0.4**：修复裸 URL 被拆成多色、粗体书名号被粗体色覆盖、任务清单 `x` 被误染英文色；编辑模式改为视口化处理（大文档大幅提速）；切换亮/暗主题即时刷新；阅读模式内联样式加 `!important`。
- 更早版本见仓库备份与 `main.bak*.js`。

## 许可证

ISC，见 [LICENSE](LICENSE)。

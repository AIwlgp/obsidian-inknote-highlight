// ============================================================
// 墨记中文结构高亮 v2 — 全新实现
//
// 设计原则（只有两件事）：
//   1. 正则匹配：一张规则表，每类染色 = 「正则 + 样式」一行
//   2. 严格最内层：嵌套染色时最内层的颜色必胜，逐层往外
//      标记字符（**、~~、`、#、>）用捕获组天然跳过，不参与染色
// ============================================================

const obsidian = require("obsidian");
const { ViewPlugin, Decoration, EditorView } = require("@codemirror/view");

// 主题切换纪元标记：编辑模式需在亮/暗主题切换后强制重建装饰（默认只在 doc/viewport 变化时重建）
let themeEpoch = 0;

// ---------- 配色（沿用 v1 色值） ----------
const THEMES = {
  light: {
    vol: "#C62828", chapter: "#6A3AB2", section: "#B07C10",
    h1: "#546E7A", h2: "#607D8B", h3: "#78909C", h4: "#90A4AE",
    ordinalCircle: "#E65100", ordinalParenNum: "#BF360C", ordinalParenCn: "#8D6E63",
    arrow: "#D84315", dash: "#9E9E9E", italic: "#9575CD",
    meta: "#00838F", metaKey: "#00838F", metaValue: "#00695C",
    ref: "#8A8A8A", blockquote: "#616161",
    book: "#C2185B", quote: "#2E7D32", quoteDouble: "#388E3C", quoteBook: "#1B5E20",
    numeric: "#1565C0", bold: "#D81B60", link: "#0288D1",
    strike: "#BDBDBD", list: "#558B2F",
    en: "#3949AB", bracket: "#00897B",
  },
  dark: {
    vol: "#EF6B60", chapter: "#B58AE6", section: "#E0B341",
    h1: "#90A4AE", h2: "#A3B8C8", h3: "#B0BEC5", h4: "#C7D2DA",
    ordinalCircle: "#FFA726", ordinalParenNum: "#FF8A65", ordinalParenCn: "#A1887F",
    arrow: "#FF8A65", dash: "#757575", italic: "#B39DDB",
    meta: "#4DD0E1", metaKey: "#4DD0E1", metaValue: "#26A69A",
    ref: "#9E9E9E", blockquote: "#8D8D8D",
    book: "#F06292", quote: "#81C784", quoteDouble: "#A5D6A7", quoteBook: "#66BB6A",
    numeric: "#64A8E8", bold: "#F48FB1", link: "#4FC3F7",
    strike: "#757575", list: "#9CCC65",
    en: "#9FA8DA", bracket: "#4DB6AC",
  },
};

// ---------- 生效配色（默认 + 用户覆盖） ----------
// 用户可以在设置里逐项覆盖颜色（亮/暗各自一套）。activeThemes 是当前实际使用的配色表，
// 所有构建路径（buildRules → collectSpans → synthesize → 渲染）都读它，
// 改色后调用 applyColorOverrides + 刷新视图即可实时生效。
let activeThemes = {
  light: { ...THEMES.light },
  dark: { ...THEMES.dark },
};

function applyColorOverrides(overrides) {
  const o = overrides || {};
  activeThemes = {
    light: Object.assign({}, THEMES.light, o.light || {}),
    dark: Object.assign({}, THEMES.dark, o.dark || {}),
  };
  return activeThemes;
}

// ---------- 特殊规则配置（用户可加匹配字） ----------
// 行级规则模板：起始字 + 数字 + 标识字 + 其余内容
//   默认：第1卷 / 第1章 / 第1回 / 第1节
//   用户可把「幕」「集」「篇」等加到卷类或章节类，也可换起始字（如「序」）。
const DEFAULT_RULES_CONFIG = {
  prefix: "第",           // 起始字（字符类，可多个）
  volumeUnits: "卷",      // 卷类标识字
  chapterUnits: "回章节",  // 章节类标识字
  sectionSeparators: "空格", // 数字小节：数字与标题之间的分隔符（空格 / 、 / . / ：…）
  sectionPrefix: "",      // 数字小节：数字前的起始字（默认空，如填「第」则「第1 引言」也认）
  sectionUnits: "",       // 数字小节：标题词限定（留空=任意标题；填「引言/引子」则标题须以其开头）
};
let activeRulesConfig = { ...DEFAULT_RULES_CONFIG };

/** 通用正则转义 */
function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 解析「起始字 / 标识字 / 标题词」输入：
 *   - 含 /（或 ／）→ 按词组拆：`我/章节/章/节` → ["我","章节","章","节"]
 *   - 不含 / → 默认逐字拆（兼容「回章节」「卷幕」这类写法）
 *   - opts.whole = true → 不含 / 时整体作为一个选项（标题词如「引子」不该拆）
 */
function parseUnitOptions(input, opts) {
  const s = String(input || "").trim();
  if (!s) return [];
  if (/[\/／]/.test(s)) {
    return s.split(/[\/／]/).map((x) => x.trim()).filter(Boolean);
  }
  if (opts && opts.whole) return [s];
  return Array.from(s);
}

function applyRulesConfig(cfg) {
  const c = Object.assign({}, DEFAULT_RULES_CONFIG, cfg || {});
  const fix = (v, def) => (parseUnitOptions(v).length ? String(v).trim() : def);
  const keep = (v, def) => (v === undefined || v === null ? def : String(v).trim());
  activeRulesConfig = {
    prefix: fix(c.prefix, DEFAULT_RULES_CONFIG.prefix),
    volumeUnits: fix(c.volumeUnits, DEFAULT_RULES_CONFIG.volumeUnits),
    chapterUnits: fix(c.chapterUnits, DEFAULT_RULES_CONFIG.chapterUnits),
    sectionSeparators: fix(c.sectionSeparators, DEFAULT_RULES_CONFIG.sectionSeparators),
    // 起始字 / 标题词允许为空（空 = 不限）
    sectionPrefix: keep(c.sectionPrefix, ""),
    sectionUnits: keep(c.sectionUnits, ""),
  };
  return activeRulesConfig;
}

/** 生成「起始字 + 数字 + 标识字 + 其余」的行级正则；支持多字词组，长词优先匹配 */
function makeHeadingLineRe(prefix, units) {
  const pOpts = parseUnitOptions(prefix).sort((a, b) => b.length - a.length);
  const uOpts = parseUnitOptions(units).sort((a, b) => b.length - a.length);
  if (!pOpts.length || !uOpts.length) return null;
  const p = `(?:${pOpts.map(escapeRegExp).join("|")})`;
  const u = `(?:${uOpts.map(escapeRegExp).join("|")})`;
  return new RegExp(`^${p}[零一二三四五六七八九十百千0-9]+${u}.*$`, "gm");
}

/** 小节的「空格」写法（用户输入里用中文词表示空白，便于阅读） */
function isSpaceToken(s) {
  return s === "空格" || s === "space" || s === "Space" || s === " ";
}

/**
 * 生成数字小节正则：数字 + 分隔符 + 标题。
 * 默认分隔符为空格（保持旧行为）；用户可用 / 添加「、」「.」「：」「）」「空格」等。
 */
/** 小节的数字部分：阿拉伯数字 + 中文数字 */
const SECTION_NUM = "[零一二三四五六七八九十百千0-9]{1,4}";

/**
 * 生成数字小节正则：<起始字?><数字><分隔符><标题词?>
 *   - 起始字为空：数字直接从行首（允许前置空白）开始
 *   - 起始字如「第」：则「第1 引言」也认
 *   - 标题词为空：任意标题；填「引言/引子」则标题须以其开头
 */
function makeSectionRe(prefix, separators, units) {
  const prefixOpts = parseUnitOptions(prefix).sort((a, b) => b.length - a.length);
  // 起始字可选：填「第」后「第1 引言」与「1 引言」都认
  const p = prefixOpts.length ? `(?:${prefixOpts.map(escapeRegExp).join("|")})?` : "";

  const raw = String(separators || "").trim();
  let seps;
  if (isSpaceToken(raw)) {
    seps = "[ \\t]+";
  } else {
    const opts = parseUnitOptions(raw).map((s) => (isSpaceToken(s) ? "[ \\t]+" : escapeRegExp(s)));
    seps = opts.length ? `(?:${opts.join("|")})` : "[ \\t]+";
  }

  const unitOpts = parseUnitOptions(units, { whole: true }).sort((a, b) => b.length - a.length);
  const u = unitOpts.length ? `(?:${unitOpts.map(escapeRegExp).join("|")})` : "";

  return new RegExp(`^\\s*${p}${SECTION_NUM}${seps}${u}[^\\n]*$`, "gm");
}

// ---------- 规则表 ----------
// 每条规则：
//   re    : 正则（行级规则带 m 标志，^ $ 锚定行；行内规则不带）
//   group : 染色的捕获组号；默认 0 = 整段。标记字符（**、~~、`、#、>）
//           在组外天然不染色——不再需要 transparent span
//   atomic: true 时该 span 是原子单元，屏蔽其内部一切嵌套染色
//           （用于日期/时间：整体一色，不被内部数字打碎）
//   style : 样式对象，或函数 (match, theme) => 样式对象
//   样式键：color / bold / sizeDelta / strike / mono
function buildRules(t) {
  return [
    // ===== 行级规则（整行语义） =====
    // 卷/章节：起始字 + 数字 + 标识字（可在设置里增改，如「幕」「集」「篇」）
    { name: "vol",        re: makeHeadingLineRe(activeRulesConfig.prefix, activeRulesConfig.volumeUnits), style: { color: t.vol, bold: true, sizeDelta: 4 } },
    { name: "chapter",    re: makeHeadingLineRe(activeRulesConfig.prefix, activeRulesConfig.chapterUnits), style: { color: t.chapter, bold: true, sizeDelta: 2 } },
    // 小节标题：数字+空格（1 引言）。数字+点/顿号（1. 1、）走 orderedMark，避免混色
    { name: "numSection", re: makeSectionRe(activeRulesConfig.sectionPrefix, activeRulesConfig.sectionSeparators, activeRulesConfig.sectionUnits), style: { color: t.section, bold: true } },
    { name: "bareSection", re: /^\s*(?:简介|序|序言|前言|目录|后记|附录|凡例|校注凡例|说明|摘要|导读)\s*$/gm, style: { color: t.section, bold: true } },
    // meta（行内）：任意位置出现「中文键：值」就染，不挑词（适配小说自创词）
    // key 限定为纯中文（1-16 字）：避免 `https://...` 里的 `https:` 被当成 meta 键，
    // 把 URL 之后的正文整段染成 metaValue（v2.0.5 修复）。
    // value = 冒号后到行尾（最长 200 字），不再被中文标点截断
    // 冒号后跟双引号（他说："…"）则失效：引号内容交给 quoteDouble（优先级最高）
    { name: "metaKey",    re: /(?:^|[^\u4e00-\u9fff\w])([\u4e00-\u9fff]{1,16})(?=[：:](?!\s*["\u201C\u201D]))/gm, group: 1, style: { color: t.metaKey } },
    { name: "metaValue",  re: /(?:^|[^\u4e00-\u9fff\w])([\u4e00-\u9fff]{1,16}[：:](?!\s*["\u201C\u201D])[^\n]{0,200})/gm, group: 1, style: { color: t.metaValue } },
    { name: "divider",    re: /^\s*[=\-—─═*～~_]{6,}\s*$/gm, style: { color: t.ref } },
    // 标题：组 2 = 标题文字（组 1 是 # 标记，不染色）；颜色按 # 层级递进
    { name: "heading",    re: /^(#{1,6})\s+(.+)$/gm, group: 2, style: (m, th) => {
        const lv = m[1].length;
        return { color: [th.h1, th.h2, th.h3, th.h4][lv - 1] ?? th.h4, bold: true, sizeDelta: lv <= 2 ? (lv === 1 ? 4 : 2) : 0 };
      } },
    { name: "blockquote", re: /^\s*[>＞]\s?(.*)$/gm, group: 1, style: { color: t.blockquote } },
    // 斜体标注行（*设计原理：…、*专业术语：）：单星号开头（Obsidian 未闭合也渲染斜体）。
    // 组 1 = 整行内容；* 标记在组外天然不染色（=隐藏，与 #、**、~~ 同哲学）。
    // 排除 * 列表（* 后跟空格）与 ** 粗体（* 后跟星号）
    { name: "italicLine", re: /^\*(?!\s|\*)(.+)$/gm, group: 1, style: { color: t.italic } },
    { name: "listMark",   re: /^\s*[-*+]\s/gm, style: { color: t.list, bold: true } },
    // 任务清单标记：整块原子（屏蔽 [x] 里的 x 被 en 染成英文色）；结尾空格可选，兼容行尾
    { name: "taskMark",   re: /^\s*[-*+]\s\[[ xX]\]\s?/gm, atomic: true, style: { color: t.list, bold: true } },
    // 有序标记：支持 1. / 1、 / 1)（顿号后允许无空格，贴近中文打字）
    { name: "orderedMark", re: /^\s*\d{1,3}[.．、)]\s?/gm, style: { color: t.list, bold: true } },
    { name: "ordinal",    re: /^\s*(?:[一二三四五六七八九十]{1,3}、|[（(][一二三四五六七八九十0-9]{1,3}[)）][、.．]?)/gm, style: { color: t.ordinalCircle, bold: true } },

    // ===== 行内规则 =====
    // 中文标点（《》「」『』""（））属于内容的一部分：整段染，不拆标记
    { name: "book",        re: /《[^《》\n]{1,60}》/g, style: { color: t.book } },
    { name: "quoteDian",   re: /「[^「」\n]{1,200}」/g, style: { color: t.quote } },
    { name: "quoteBook",   re: /『[^『』\n]{1,200}』/g, style: { color: t.quoteBook } },
    { name: "quoteDouble", re: /“[^“”\n]{1,200}”|"[^"\n]{1,200}"/g, style: { color: t.quoteDouble } },
    { name: "ref",         re: /[\[［]\d{1,3}[\]］]/g, style: { color: t.ref } },
    { name: "ordinalCircle",  re: /[①-⑳]/g, style: { color: t.ordinalCircle } },
    { name: "ordinalParenNum", re: /[（(]\d{1,4}[）)]/g, style: { color: t.ordinalParenNum } },
    // 日期 / 时间：原子单元，整体一色，不被内部数字打碎
    { name: "date",        re: /\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?/g, atomic: true, style: { color: t.numeric } },
    { name: "time",        re: /\d{1,2}[:：]\d{2}/g, atomic: true, style: { color: t.numeric } },
    // 普通数字：边界排除标识符内数字（MD5 的 5 不染）与行首序号（1、1. 的 1 不染）
    { name: "num",         re: /(?<![\d.\w])\d+(?:\.\d+)?%?(?![\d.\w、.．)）])/g, style: { color: t.numeric } },
    // 数字+拉丁单位（1970s、7.83Hz）：数字后直接跟字母时 num 会失手，这里整体一色
    { name: "numUnit",     re: /(?<![\d.\w])\d+(?:\.\d+)?[A-Za-z]{1,5}(?![A-Za-z0-9])/g, style: { color: t.numeric } },
    // 结构连接符：流程箭头（→）与破折号（——），中文笔记高频字符
    { name: "arrow",       re: /[→⇒]/g, style: { color: t.arrow } },
    { name: "dash",        re: /—{2,}/g, style: { color: t.dash } },
    // 英文/拉丁标识符：独立染色（靛蓝），边界排除数字字母下划线
    { name: "en",          re: /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9_.-]{0,19}(?![A-Za-z0-9_])/g, style: { color: t.en } },
    // markdown 标记：组 1 = 内容，** ~~ ` 不染色。priority -1（包裹规则）——
    // 与内容规则（书名号等）同坐标时，内容规则胜（颜色给内容），粗/删线仅保留
    { name: "bold",        re: /\*\*([^*\n]+?)\*\*/g, group: 1, priority: -1, style: { color: t.bold, bold: true } },
    { name: "strike",      re: /~~([^~\n]+?)~~/g, group: 1, priority: -1, style: { color: t.strike, strike: true } },
    { name: "inlineCode",  re: /`([^`\n]+?)`/g, group: 1, style: { color: t.ref, mono: true } },
    // 链接 / 图片 / URL
    { name: "link",        re: /\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)/g, style: { color: t.link } },
    { name: "wikiLink",    re: /\[\[([^\]\n]{1,100})\]\]/g, group: 1, style: { color: t.link } },
    { name: "image",       re: /!\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)/g, style: { color: t.link } },
    // 裸 URL 整体一色（link），屏蔽内部 en/num 染色，避免 URL 被拆成多色
    { name: "url",         re: /https?:\/\/[^\s<>\n]{4,200}/g, atomic: true, style: { color: t.link } },
  ];
}

// ---------- 容器检测：代码围栏（多行上下文，需单独处理） ----------
// 返回 { skip: [{start, end}], tableRows: Map<行号, 'header'> }
// skip 区间（代码围栏内）的行内规则全部跳过；
// 表格表头行（下一行是 |---| 分隔线）做 meta 染色，数据行按正文正常染色
function detectContainers(text) {
  const skip = [];
  const tableRows = new Map();
  const lines = text.split("\n");
  const FENCE = /^\s*(```|~~~)/;
  const T_SEP = /^\s*\|[\s:\-|]+\|\s*$/;
  const T_ROW = /^\s*\|.*\|\s*$/;

  // 行偏移：第 i 行的 start 偏移
  const lineStart = [];
  {
    let off = 0;
    for (let i = 0; i < lines.length; i++) { lineStart.push(off); off += lines[i].length + 1; }
  }

  // 1) 围栏（代码块整体跳过）
  let inFence = false, fenceStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      if (!inFence) { fenceStart = lineStart[i]; inFence = true; }
      else { skip.push({ start: fenceStart, end: lineStart[i] + lines[i].length }); inFence = false; }
    }
  }
  if (inFence) skip.push({ start: fenceStart, end: text.length });

  // 2) 管道表格表头：下一行是分隔线（|---|）即表头 → meta 染色
  //    表头行内容仍走行内规则（最内层必胜）；数据行是正文，不特殊处理
  for (let i = 0; i < lines.length; i++) {
    if (T_SEP.test(lines[i]) && i > 0 && T_ROW.test(lines[i - 1])) {
      tableRows.set(i - 1, "header");
    }
  }
  return { skip, tableRows, lineStart, lines };
}

// ---------- 容器缓存（编辑模式） ----------
// detectContainers 是 O(n) 全篇扫描（逐行 + 三个正则），但同一个文档在
// 「滚动视口 / 切换主题 / 同一帧内多次 build」时正文并没有变，没必要重扫。
// 这里按 text 全等缓存结果：命中直接复用，未命中才真正扫描。
// （视图滚动时 CM6 会频繁触发 update，这条缓存是主要收益点。）
function createContainerCache() {
  let lastText = null;
  let lastCtx = null;
  let hits = 0;
  let misses = 0;
  return {
    get(text) {
      if (lastText !== null && text === lastText && lastCtx) {
        hits++;
        return lastCtx;
      }
      lastCtx = detectContainers(text);
      lastText = text;
      misses++;
      return lastCtx;
    },
    stats() { return { hits, misses }; },
  };
}

// ---------- 收集 spans ----------
// 对（视口窗口）跑每条规则；落在 skip 区间内的匹配丢弃。
// opts.winStart/winEnd：相对整篇正文的窗口偏移（默认整篇 = 阅读模式）。
// 返回的 span 坐标相对「窗口切片」（window-relative），合成器可直接用。
// opts.ctx：由 detectContainers 预计算的容器信息（编辑模式视口化时避免重复扫描）。
function collectSpans(text, theme, opts = {}) {
  const { winStart = 0, winEnd = text.length, ctx = null } = opts;
  const { skip, tableRows, lineStart, lines } = ctx ?? detectContainers(text);
  const inSkip = (idx) => {
    for (const s of skip) if (idx >= s.start && idx < s.end) return true;
    return false;
  };
  const spans = [];
  // 窗口切片（整篇时直接引用，避免拷贝）
  const slice = winStart === 0 && winEnd === text.length ? text : text.slice(winStart, winEnd);
  const off = winStart; // 把窗口内坐标换算成整篇坐标时加上的偏移

  // 表格表头行染色（meta 色 + 加粗）——仅窗口内的表头行
  for (const [i, kind] of tableRows) {
    if (kind !== "header") continue;
    const s = lineStart[i], e = s + lines[i].length;
    if (s >= winStart && e <= winEnd) spans.push({ start: s - off, end: e - off, color: theme.meta, bold: true });
  }

  const rules = buildRules(theme);

  // 小节标题行（numSection）优先于 meta：这些行里「：」不能把标题文字抢成 meta 色，
  // 否则「1 引言：」会变成「1(小节色) + 引言(meta键色) + ：(meta值色)」的花脸。
  // 预扫描行区间，供下面的 metaKey/metaValue 过滤使用。
  const numSectionRule = rules.find((r) => r.name === "numSection");
  const numSectionRanges = [];
  if (numSectionRule) {
    const nre = new RegExp(numSectionRule.re.source, numSectionRule.re.flags.replace("g", "") + "g");
    for (const m of slice.matchAll(nre)) numSectionRanges.push([m.index, m.index + m[0].length]);
  }
  const inNumSection = (idx) => numSectionRanges.some(([s, e]) => idx >= s && idx < e);

  for (const rule of rules) {
    // 给正则补 d 标志，用 indices 拿捕获组区间（准确、不依赖 indexOf）
    const re = rule.re.flags.includes("d") ? rule.re : new RegExp(rule.re.source, rule.re.flags + "d");
    for (const m of slice.matchAll(re)) {
      if (inSkip(off + m.index)) continue;
      // 小节标题行里：meta 规则让位（其他规则不变）
      if ((rule.name === "metaKey" || rule.name === "metaValue") && inNumSection(m.index)) continue;
      const st = typeof rule.style === "function" ? rule.style(m, theme) : rule.style;
      if (!st) continue;
      const seg = m.indices[rule.group ?? 0];
      if (!seg) continue;
      const [start, end] = seg;
      if (end <= start) continue;
      const span = { start, end, ...st };
      if (rule.atomic) span.atomic = true;
      if (rule.priority !== undefined) span.priority = rule.priority;
      spans.push(span);
    }
  }
  // 括号栈式配对：「（）是一个整体」「【】也是一个整体」
  // 栈式就近配对，嵌套时外层/内层都完整染色；
  // （）区间无文字（纯数字括号留给 ordinalParenNum，纯标点不染）；
  // 未配对的括号不染色。
  {
    const NL2 = String.fromCharCode(10, 10);
    // 括号内有「文字」（中文或拉丁字母）才配对染色
    const hasWord = (s) => { for (const ch of s) { const c = ch.codePointAt(0); if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return true; } return false; };
    const pair = (opens, closes, color, needWord) => {
      const stack = [];
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        if (inSkip(off + i)) continue;
        if (opens.includes(ch)) { stack.push(i); continue; }
        if (closes.includes(ch)) {
          if (!stack.length) continue;
          const open = stack.pop();
          const inner = slice.slice(open + 1, i);
          if (inner.includes(NL2)) continue; // 跨空行视为跨段，不配对
          if (needWord && !hasWord(inner)) continue;
          spans.push({ start: open, end: i + 1, color });
        }
      }
    };
    pair(["（", "("], ["）", ")"], theme.ordinalParenCn, true);
    pair(["【"], ["】"], theme.bracket, false);
  }
  return spans;
}

// ---------- 合成器：严格最内层 + 原子屏蔽 + 属性叠加 ----------
// 每个位置被若干 span 覆盖。颜色取「最内层」：
//   扫描线从左到右，span 按 (start 升序, end 降序) 进入 active，
//   active 尾部就是最后打开、最内层的 span。
//   规则：
//     - 最内层 atomic span 一票定色（屏蔽其内部所有嵌套）
//     - 否则取最内层带颜色的 span 定色（完全同坐标时按 priority 决胜：内容规则 > 包裹规则）
//     - 属性（bold / sizeDelta / strike / mono）来自所有覆盖 span 的并集
//       （粗体里的书名号：颜色给书名号，粗细保留粗体）
function synthesize(text, spans) {
  const len = text.length;
  // 切点：span 端点 + 空行边界（\n\n 处强制切，段落边界）
  const cut = new Set([0, len]);
  for (const s of spans) {
    cut.add(Math.max(0, Math.min(len, s.start)));
    cut.add(Math.max(0, Math.min(len, s.end)));
  }
  for (let i = 0; i + 1 < len; i++) {
    if (text[i] === "\n" && text[i + 1] === "\n") { cut.add(i); cut.add(i + 2); }
  }
  const pts = [...cut].sort((a, b) => a - b);

  const byStart = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const byEnd = [...spans].sort((a, b) => a.end - b.end || a.start - b.start);
  const active = [];
  let si = 0, ei = 0;

  const tokens = [];
  let buf = "", cur = null, curKey = "";

  const keyOf = (s, bold, strike, mono, size) =>
    `${s && s.color ? s.color : ""}|${bold ? 1 : 0}|${strike ? 1 : 0}|${mono ? 1 : 0}|${size || 0}`;

  // 颜色候选更优判定：更内层优先（start 更大，或同 start 时 end 更小）；
  // 完全同坐标时按 priority 决胜（内容规则 priority 高于包裹规则，颜色归内容）
  const betterColor = (a, b) => {
    if (a.start !== b.start) return a.start > b.start;
    if (a.end !== b.end) return a.end < b.end;
    return (a.priority ?? 0) > (b.priority ?? 0);
  };

  const flush = () => {
    if (!buf) return;
    tokens.push(cur ? { text: buf, ...cur } : { text: buf });
    buf = "";
  };

  for (let k = 0; k + 1 < pts.length; k++) {
    const m = pts[k], n = pts[k + 1];
    if (m >= n) continue;
    while (si < byStart.length && byStart[si].start <= m) active.push(byStart[si++]);
    while (ei < byEnd.length && byEnd[ei].end <= m) {
      const idx = active.indexOf(byEnd[ei]);
      if (idx >= 0) active.splice(idx, 1);
      ei++;
    }

    // 裁决：最内层 atomic → 最内层有色（同坐标按 priority 决胜）；属性叠加
    let colorTop = null, atomTop = null;
    let bold = false, strike = false, mono = false, size = 0;
    for (let i = active.length - 1; i >= 0; i--) {
      const s = active[i];
      if (s.atomic && !atomTop) atomTop = s;
      if (s.color && (!colorTop || betterColor(s, colorTop))) colorTop = s;
      if (s.bold) bold = true;
      if (s.strike) strike = true;
      if (s.mono) mono = true;
      if (s.sizeDelta) size = Math.max(size, s.sizeDelta);
    }
    const winner = atomTop ?? colorTop;
    const key = keyOf(winner, bold, strike, mono, size);
    if (key !== curKey) {
      flush();
      curKey = key;
      cur = winner ? { color: winner.color, bold, strike, mono, sizeDelta: size || undefined } : null;
    }
    buf += text.slice(m, n);
  }
  flush();
  return tokens;
}

function buildTokens(text, isDark) {
  if (!text) return [];
  const theme = isDark ? activeThemes.dark : activeThemes.light;
  return synthesize(text, collectSpans(text, theme));
}

// 视口窗口版：只处理 [winStart, winEnd) 一段（编辑模式用），
// ctx 为整篇的容器信息（detectContainers 结果），保证代码围栏/表格判定正确。
// 返回的 token 坐标相对窗口切片（window-relative），由调用方换算成文档偏移。
function buildTokensIn(text, isDark, ctx, winStart, winEnd) {
  if (!text || winEnd <= winStart) return [];
  const theme = isDark ? activeThemes.dark : activeThemes.light;
  const slice = text.slice(winStart, winEnd);
  return synthesize(slice, collectSpans(text, theme, { winStart, winEnd, ctx }));
}

// ---------- 阅读模式（PostProcessor） ----------
const SKIP_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "INPUT", "TEXTAREA"]);

// 用 !important 设置内联样式，保证不被 Obsidian 默认样式的 !important 规则覆盖（与编辑模式一致）
function setStyle(el, prop, val) { el.style.setProperty(prop, val, "important"); }

function readingProcessor(el) {
  const isDark = document.body.classList.contains("theme-dark");
  const t = isDark ? activeThemes.dark : activeThemes.light;

  // 元素级染色：Obsidian 已把 # 标题和 ** 粗体渲染成元素，文本节点里没有标记字符
  const headingColor = { H1: t.h1, H2: t.h2, H3: t.h3, H4: t.h4, H5: t.h4, H6: t.h4 };
  for (const h of el.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const c = headingColor[h.tagName];
    if (c) { setStyle(h, "color", c); setStyle(h, "font-weight", "bold"); }
  }
  for (const s of el.querySelectorAll("strong")) setStyle(s, "color", t.bold);
  // 斜体：Obsidian 已把 *…* 渲染成 <em>（未闭合的开头单 * 同样渲染且标记隐藏）
  for (const s of el.querySelectorAll("em")) setStyle(s, "color", t.italic);
  // 表格表头：meta 色 + 加粗（与编辑模式一致）
  for (const th of el.querySelectorAll("th")) { setStyle(th, "color", t.meta); setStyle(th, "font-weight", "bold"); }

  // 文本节点级染色
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName) || parent.classList.contains("inknote-hl")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  for (let n; (n = walker.nextNode()); ) textNodes.push(n);

  for (const node of textNodes) {
    const tokens = buildTokens(node.nodeValue, isDark);
    const hasStyle = tokens.some((tk) => tk.color || tk.bold || tk.sizeDelta || tk.strike || tk.mono);
    if (!hasStyle) continue;
    const frag = document.createDocumentFragment();
    for (const tk of tokens) {
      if (!tk.color && !tk.bold && !tk.sizeDelta && !tk.strike && !tk.mono) {
        frag.appendChild(document.createTextNode(tk.text));
        continue;
      }
      const span = document.createElement("span");
      span.className = "inknote-hl";
      span.textContent = tk.text;
      if (tk.color) setStyle(span, "color", tk.color);
      if (tk.bold) setStyle(span, "font-weight", "bold");
      if (tk.sizeDelta) setStyle(span, "font-size", `calc(1em + ${tk.sizeDelta}px)`);
      if (tk.strike) setStyle(span, "text-decoration", "line-through");
      if (tk.mono) setStyle(span, "font-family", "var(--font-monospace)");
      frag.appendChild(span);
    }
    node.parentNode?.replaceChild(frag, node);
  }
}

// ---------- 编辑模式（CodeMirror ViewPlugin） ----------
const editingPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      // 每个编辑器视图一个容器缓存：text 未变时复用 detectContainers 的结果
      this.containers = createContainerCache();
      this.decorations = this.build(view);
      this._dark = document.body.classList.contains("theme-dark");
      this._epoch = themeEpoch;
    }
    update(u) {
      // 主题切换纪元变化（themeEpoch）或主题 class 变化时也重建，保证切换亮/暗后即时换色
      const dark = document.body.classList.contains("theme-dark");
      if (u.docChanged || u.viewportChanged || dark !== this._dark || themeEpoch !== this._epoch) {
        this._dark = dark;
        this._epoch = themeEpoch;
        this.decorations = this.build(u.view);
      }
    }
    build(view) {
      const text = view.state.doc.toString();
      const isDark = document.body.classList.contains("theme-dark");
      // 整篇扫描一次容器（代码围栏/表格），结果按 text 缓存；
      // 视口滚动/主题切换时命中缓存，不再每帧全篇重扫。
      const ctx = this.containers.get(text);
      const deco = [];
      // 视口窗口：展开到行边界，合并相邻/重叠项，避免重复装饰
      const win = [];
      for (const r of view.visibleRanges) {
        const s = view.state.doc.lineAt(r.from).from;
        const e = view.state.doc.lineAt(r.to).to;
        if (win.length && s <= win[win.length - 1][1]) win[win.length - 1][1] = Math.max(win[win.length - 1][1], e);
        else win.push([s, e]);
      }
      for (const [s, e] of win) {
        const tokens = buildTokensIn(text, isDark, ctx, s, e);
        let pos = s;
        for (const tk of tokens) {
          const from = pos, to = pos + tk.text.length;
          pos = to;
          if (!tk.color && !tk.bold && !tk.sizeDelta && !tk.strike && !tk.mono) continue;
          // mark decoration 不允许跨行；有样式的 token 都在单行内
          if (tk.text.includes("\n")) continue;
          const styles = [];
          if (tk.color) styles.push(`color: ${tk.color} !important`);
          if (tk.bold) styles.push("font-weight: bold !important");
          if (tk.sizeDelta) styles.push(`font-size: calc(1em + ${tk.sizeDelta}px)`);
          if (tk.strike) styles.push("text-decoration: line-through");
          if (tk.mono) styles.push("font-family: var(--font-monospace) !important");
          deco.push(Decoration.mark({ attributes: { style: styles.join("; ") } }).range(from, to));
        }
      }
      return Decoration.set(deco, true);
    }
  },
  { decorations: (v) => v.decorations }
);

// ---------- 插件入口 ----------
module.exports = class InknoteHighlight extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({ colors: { light: {}, dark: {} }, rules: {} }, await this.loadData());
    if (!this.settings.colors) this.settings.colors = { light: {}, dark: {} };
    if (!this.settings.rules) this.settings.rules = {};
    applyColorOverrides(this.settings.colors);
    applyRulesConfig(this.settings.rules);

    this.registerMarkdownPostProcessor(readingProcessor);
    this.registerEditorExtension(editingPlugin);

    this.addSettingTab(new HighlightSettingsTab(this.app, this));

    // 主题切换监听：body 的 theme-dark/theme-light class 变化后，递增纪元并强制各编辑器重算装饰。
    // 否则切换亮/暗主题时编辑模式的高亮色不会刷新（默认只在 doc/viewport 变化时重建）。
    let lastDark = document.body.classList.contains("theme-dark");
    const observer = new MutationObserver(() => {
      const dark = document.body.classList.contains("theme-dark");
      if (dark === lastDark) return;
      lastDark = dark;
      themeEpoch++;
      for (const el of document.querySelectorAll(".cm-editor")) {
        const v = EditorView.findFromDOM(el);
        if (v) v.dispatch({});
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.register(() => observer.disconnect());
  }

  /** 颜色变更后重刷所有已打开视图：编辑模式（dispatch 重建）+ 阅读模式（rerender） */
  refreshViews() {
    themeEpoch++;
    for (const el of document.querySelectorAll(".cm-editor")) {
      const v = EditorView.findFromDOM(el);
      if (v) v.dispatch({});
    }
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const pm = leaf.view && leaf.view.previewMode;
      if (pm && typeof pm.rerender === "function") pm.rerender(true);
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};

// ---------- 设置面板：逐项改色 + 实时预览 ----------

// 颜色键 → 中文说明（覆盖 THEMES 里的全部键）
const COLOR_LABELS = {
  vol: "卷标题（第X卷）",
  chapter: "章节标题（第X回/章/节）",
  section: "小节 / 固定标题（1 引言、简介）",
  h1: "标题 # 一级",
  h2: "标题 ## 二级",
  h3: "标题 ### 三级",
  h4: "标题 #### 四级及以下",
  ordinalCircle: "圆圈序号 ①",
  ordinalParenNum: "括号数字（1961）",
  ordinalParenCn: "中文括号（）",
  arrow: "箭头 →",
  dash: "破折号 ——",
  italic: "斜体标注行 *…",
  meta: "表格表头",
  metaKey: "meta 键（作者）",
  metaValue: "meta 值（：鲁迅）",
  ref: "参考文献 [1]",
  blockquote: "引用行 >",
  book: "书名号《》",
  quote: "引号「」",
  quoteDouble: "引号“”",
  quoteBook: "引号『』",
  numeric: "数字 / 日期 / 时间",
  bold: "粗体 **",
  link: "链接 / URL",
  strike: "删除线 ~~",
  list: "列表标记 -",
  en: "英文 / 拉丁标识符",
  bracket: "方括号【】",
};

// 顶部整体预览用的示例文本：卷/章两行跟随当前规则配置动态生成，
// 这样把「卷」换成「幕」后，预览里会显示「第1幕 风起」而不是写死的「第1卷」。
function buildPreviewText() {
  const cfg = activeRulesConfig;
  const p = parseUnitOptions(cfg.prefix)[0] || "第";
  const vu = parseUnitOptions(cfg.volumeUnits)[0] || "卷";
  const cu = parseUnitOptions(cfg.chapterUnits)[0] || "章";
  const sep = firstSeparator(cfg.sectionSeparators);
  const sPrefix = parseUnitOptions(cfg.sectionPrefix)[0] || "";
  const sUnit = parseUnitOptions(cfg.sectionUnits, { whole: true })[0] || "引言";
  return [
    "《梦境四重奏》「引号」『书名引号』“双引号”",
    `${p}1${vu} 妊沐`,
    `${p}1${cu} 贾核`,
    `${sPrefix}1${sep}${sUnit}`,
    "简介",
    "作者：aiwlgp",
    "---",
    "# 一级标题",
    "## 二级标题",
    "### 三级标题",
    "#### 四级标题",
    "> 引用行",
    "*斜体标注行",
    "- 列表项",
    "- [x] 任务项",
    "一、中文序号",
    "[1] ① （1961） （中文括号）",
    "2024-01-01 12:30 1970s 7.83Hz",
    "→ ——",
    "**粗体** ~~删除~~ `代码`",
    "[链接](https://example.com) [[wiki]]",
    "",
    "| 表头 | 表头 |",
    "|---|---|",
    "| 正文 | 正文 |",
  ].join("\n");
}

// 每个颜色项的示例文本：必须带上该规则所需的标记，否则规则不匹配、示例永远无色。
// （例如 heading 规则要求行首 #，bold 要求 **，strike 要求 ~~，meta 表头需要表格两行）
const COLOR_SAMPLES = {
  vol: "第1卷 风起",
  chapter: "第1章 开端",
  section: "1 引言",
  h1: "# 一级标题",
  h2: "## 二级标题",
  h3: "### 三级标题",
  h4: "#### 四级标题",
  ordinalCircle: "①②③",
  ordinalParenNum: "（1961）",
  ordinalParenCn: "（中文括号）",
  arrow: "→ ⇒",
  dash: "————",
  italic: "*斜体标注行",
  meta: "| 表头 |\n|---|",
  metaKey: "作者：aiwlgp",
  metaValue: "作者：aiwlgp",
  ref: "[1] [12]",
  blockquote: "> 引用行",
  book: "《梦境四重奏》",
  quote: "「引号」",
  quoteDouble: "“双引号”",
  quoteBook: "『书名引号』",
  numeric: "2024-01-01 1234 7.83Hz",
  bold: "**粗体**",
  link: "[链接](url)",
  strike: "~~删除线~~",
  list: "- 列表项",
  en: "English ABC",
  bracket: "【方括号】",
};

function renderSample(el, sample, isDark) {
  if (!el) return;
  el.empty();
  for (const tk of buildTokens(sample, isDark)) {
    if (!tk.color && !tk.bold && !tk.strike && !tk.mono && !tk.sizeDelta) {
      el.appendChild(document.createTextNode(tk.text));
      continue;
    }
    const span = document.createElement("span");
    span.textContent = tk.text;
    if (tk.color) span.style.setProperty("color", tk.color, "important");
    if (tk.bold) span.style.setProperty("font-weight", "bold", "important");
    if (tk.sizeDelta) span.style.setProperty("font-size", `calc(1em + ${tk.sizeDelta}px)`, "important");
    if (tk.strike) span.style.setProperty("text-decoration", "line-through", "important");
    if (tk.mono) span.style.setProperty("font-family", "var(--font-monospace)", "important");
    el.appendChild(span);
  }
}

// 逐项示例：vol/chapter 跟随用户配置动态生成（用户可能把「卷」换成「幕」），其余用固定示例
/** 取第一个分隔符（用于示例/预览展示） */
function firstSeparator(input) {
  const raw = String(input || "").trim();
  if (isSpaceToken(raw)) return " ";
  const opts = parseUnitOptions(raw);
  const s = opts[0] || "空格";
  return isSpaceToken(s) ? " " : s;
}

function sampleFor(key) {
  const cfg = activeRulesConfig;
  const p = parseUnitOptions(cfg.prefix)[0] || "第";
  if (key === "vol") return `${p}1${parseUnitOptions(cfg.volumeUnits)[0] || "卷"} 妊沐`;
  if (key === "chapter") return `${p}1${parseUnitOptions(cfg.chapterUnits)[0] || "章"} 贾核`;
  if (key === "section") {
    const sp = parseUnitOptions(cfg.sectionPrefix)[0] || "";
    const sep = firstSeparator(cfg.sectionSeparators);
    const su = parseUnitOptions(cfg.sectionUnits, { whole: true })[0] || "引言";
    return `${sp}1${sep}${su}`;
  }
  return COLOR_SAMPLES[key] || key;
}

function renderPreview(container, isDark) {
  if (!container) return;
  container.empty();
  const pre = container.createEl("pre");
  pre.style.cssText = [
    "white-space: pre-wrap",
    "margin: 0",
    "padding: 12px",
    "border: 1px solid var(--background-modifier-border)",
    "border-radius: 6px",
    "font-family: var(--font-text)",
    "font-size: 13px",
    "line-height: 1.7",
    "max-height: 420px",
    "overflow: auto",
    isDark ? "background: #1e1e1e; color: #dcdcdc" : "background: #ffffff; color: #222222",
  ].join("; ");
  const frag = document.createDocumentFragment();
  for (const tk of buildTokens(buildPreviewText(), isDark)) {
    if (!tk.color && !tk.bold && !tk.strike && !tk.mono && !tk.sizeDelta) {
      frag.appendChild(document.createTextNode(tk.text));
      continue;
    }
    const span = document.createElement("span");
    span.textContent = tk.text;
    if (tk.color) span.style.setProperty("color", tk.color, "important");
    if (tk.bold) span.style.setProperty("font-weight", "bold", "important");
    if (tk.sizeDelta) span.style.setProperty("font-size", `calc(1em + ${tk.sizeDelta}px)`, "important");
    if (tk.strike) span.style.setProperty("text-decoration", "line-through", "important");
    if (tk.mono) span.style.setProperty("font-family", "var(--font-monospace)", "important");
    frag.appendChild(span);
  }
  pre.appendChild(frag);
}

class HighlightSettingsTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.previewEls = { light: null, dark: null };
    this.sampleEls = {};
    this.ruleInputRefs = { prefix: [], volumeUnits: [], chapterUnits: [], sectionPrefix: [], sectionSeparators: [], sectionUnits: [] };
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    this.sampleEls = {};
    this.ruleInputRefs = { prefix: [], volumeUnits: [], chapterUnits: [], sectionPrefix: [], sectionSeparators: [], sectionUnits: [] };

    containerEl.createEl("h3", { text: "实时预览" });
    const wrap = containerEl.createDiv();
    wrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;";
    for (const mode of ["light", "dark"]) {
      const box = wrap.createDiv();
      const label = box.createEl("div", { text: mode === "light" ? "亮色主题" : "暗色主题" });
      label.style.cssText = "font-weight:600;margin-bottom:6px;color:var(--text-muted);";
      const el = box.createDiv();
      this.previewEls[mode] = el;
    }
    this.refreshPreviews();

    for (const mode of ["light", "dark"]) {
      containerEl.createEl("h3", { text: mode === "light" ? "亮色主题颜色" : "暗色主题颜色" });
      const hint = containerEl.createEl("p", {
        text: "逐项修改；点击 ↺ 恢复该项默认值。修改会立即应用到已打开的笔记。",
      });
      hint.style.color = "var(--text-muted)";
      this.renderColorGroup(containerEl, mode);
    }

    new obsidian.Setting(containerEl)
      .setName("重置全部颜色")
      .setDesc("清空所有自定义颜色，恢复内置配色。")
      .addButton((b) => b.setButtonText("全部恢复默认").onClick(async () => {
        this.plugin.settings.colors = { light: {}, dark: {} };
        await this.plugin.saveSettings();
        applyColorOverrides(this.plugin.settings.colors);
        this.plugin.refreshViews();
        this.display();
      }));
  }

  refreshPreviews() {
    renderPreview(this.previewEls.light, false);
    renderPreview(this.previewEls.dark, true);
  }

  /** 修改特殊规则（起始字 / 标识字）：保存 → 应用 → 刷新视图与示例 */
  async updateRule(key, value) {
    const s = this.plugin.settings;
    s.rules = s.rules || {};
    s.rules[key] = value;
    await this.plugin.saveSettings();
    const applied = applyRulesConfig(s.rules);
    this.plugin.refreshViews();
    this.refreshPreviews();
    // 同步其他入口的输入框（亮/暗两组各有一份；不打断正在输入的那个）
    const shown = applied[key];
    for (const el of this.ruleInputRefs[key] || []) {
      if (el !== document.activeElement && el.value !== shown) el.value = shown;
    }
    for (const [k, v] of Object.entries(this.sampleEls || {})) {
      const rulesKey = k.split(":")[1];
      renderSample(v.el, sampleFor(rulesKey), v.mode === "dark");
    }
  }

  async applyChange(mode, key, value) {
    const colors = this.plugin.settings.colors;
    colors[mode] = colors[mode] || {};
    if (value) colors[mode][key] = value;
    else delete colors[mode][key];
    await this.plugin.saveSettings();
    applyColorOverrides(colors);
    this.plugin.refreshViews();
    this.refreshPreviews();
  }

  /** 给「卷标题 / 章节标题」行挂上折叠的规则编辑区（点名称最左侧箭头展开） */
  attachRuleEditor(setting, key) {
    const caret = document.createElement("span");
    caret.textContent = "▸";
    caret.title = key === "vol" ? "编辑卷类规则" : key === "chapter" ? "编辑章节类规则" : "编辑小节规则";
    caret.style.cssText = "cursor:pointer;margin-right:6px;user-select:none;opacity:0.75;";
    setting.nameEl.prepend(caret);

    const detail = document.createElement("div");
    detail.style.cssText = "display:none;padding:2px 0 10px 26px;";
    setting.settingEl.after(detail);

    const hint = document.createElement("div");
    hint.textContent = key === "section"
      ? "三部分都可留空/自定义：起始字（如「第」）、分隔符（空格/、/./：）、标题词（留空=任意；填「引言/引子」则标题须以其开头）。"
      : "单字直接写；词组用 / 分隔，如 我/章节/章/节（长词优先匹配）";
    hint.style.cssText = "color:var(--text-muted);font-size:11px;margin:2px 0 4px;";
    detail.appendChild(hint);

    const cfg = this.plugin.settings.rules || {};
    if (key === "vol") {
      this.ruleRow(detail, "起始字", cfg.prefix || DEFAULT_RULES_CONFIG.prefix, "prefix");
      this.ruleRow(detail, "卷类标识字", cfg.volumeUnits || DEFAULT_RULES_CONFIG.volumeUnits, "volumeUnits");
    } else if (key === "chapter") {
      this.ruleRow(detail, "起始字", cfg.prefix || DEFAULT_RULES_CONFIG.prefix, "prefix");
      this.ruleRow(detail, "章节类标识字", cfg.chapterUnits || DEFAULT_RULES_CONFIG.chapterUnits, "chapterUnits");
    } else {
      this.ruleRow(detail, "起始字", cfg.sectionPrefix || "", "sectionPrefix");
      this.ruleRow(detail, "分隔符", cfg.sectionSeparators || DEFAULT_RULES_CONFIG.sectionSeparators, "sectionSeparators");
      this.ruleRow(detail, "引言类标识字", cfg.sectionUnits || "", "sectionUnits");
    }

    let open = false;
    caret.addEventListener("click", () => {
      open = !open;
      caret.textContent = open ? "▾" : "▸";
      detail.style.display = open ? "block" : "none";
    });
  }

  ruleRow(parent, label, value, key) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0;";
    const lb = document.createElement("span");
    lb.textContent = label;
    lb.style.cssText = "min-width:96px;color:var(--text-muted);font-size:12px;";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.style.cssText = "flex:1;max-width:260px;";
    input.addEventListener("input", () => { this.updateRule(key, input.value); });
    row.append(lb, input);
    parent.appendChild(row);
    if (!this.ruleInputRefs[key]) this.ruleInputRefs[key] = [];
    this.ruleInputRefs[key].push(input);
  }

  renderColorGroup(parent, mode) {
    const defaults = THEMES[mode];
    const overrides = this.plugin.settings.colors[mode] || {};
    const isDark = mode === "dark";
    for (const key of Object.keys(defaults)) {
      let picker = null;
      const setting = new obsidian.Setting(parent).setName(COLOR_LABELS[key] || key);

      // 卷 / 章 / 小节：名称最左侧加折叠箭头，展开后编辑该类的匹配字
      if (key === "vol" || key === "chapter" || key === "section") this.attachRuleEditor(setting, key);

      // 名称后面的逐项实时示例：直接显示该 token 当前颜色/样式的效果
      const sampleEl = setting.nameEl.createSpan({ cls: "inknote-color-sample" });
      sampleEl.style.cssText = "margin-left:12px;opacity:0.9;font-weight:normal;white-space:pre-wrap;";
      const sample = sampleFor(key);
      this.sampleEls[mode + ":" + key] = { el: sampleEl, mode };
      renderSample(sampleEl, sample, isDark);

      setting
        .addColorPicker((cp) => {
          picker = cp;
          cp.setValue(overrides[key] || defaults[key]).onChange(async (v) => {
            await this.applyChange(mode, key, v);
            renderSample(sampleEl, sample, isDark);
          });
        })
        .addExtraButton((b) => b
          .setIcon("rotate-ccw")
          .setTooltip("恢复默认")
          .onClick(async () => {
            await this.applyChange(mode, key, null);
            if (picker) picker.setValue(defaults[key]);
            renderSample(sampleEl, sample, isDark);
          }));
    }
  }
}

// 离线测试出口（Obsidian 只读 module.exports 本身，忽略附加属性）。
// 供 test/ 下的 node --test 用例直接调用纯逻辑，无需完整 Obsidian 运行时。
module.exports.__test = {
  THEMES,
  applyColorOverrides,
  getActiveThemes: () => activeThemes,
  applyRulesConfig,
  getRulesConfig: () => activeRulesConfig,
  DEFAULT_RULES_CONFIG,
  makeHeadingLineRe,
  makeSectionRe,
  parseUnitOptions,
  firstSeparator,
  sampleFor,
  COLOR_SAMPLES,
  COLOR_LABELS,
  buildPreviewText,
  buildRules,
  detectContainers,
  createContainerCache,
  collectSpans,
  synthesize,
  buildTokens,
  buildTokensIn,
};

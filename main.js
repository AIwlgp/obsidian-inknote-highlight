// src/main.js
var obsidian = require("obsidian");
var { ViewPlugin, Decoration, EditorView } = require("@codemirror/view");
var themeEpoch = 0;
var THEMES = {
  light: {
    vol: "#C62828",
    chapter: "#6A3AB2",
    section: "#B07C10",
    h1: "#546E7A",
    h2: "#607D8B",
    h3: "#78909C",
    h4: "#90A4AE",
    ordinalCircle: "#E65100",
    ordinalParenNum: "#BF360C",
    ordinalParenCn: "#8D6E63",
    arrow: "#D84315",
    dash: "#9E9E9E",
    italic: "#9575CD",
    meta: "#00838F",
    metaKey: "#00838F",
    metaValue: "#00695C",
    ref: "#8A8A8A",
    blockquote: "#616161",
    book: "#C2185B",
    quote: "#2E7D32",
    quoteDouble: "#388E3C",
    quoteBook: "#1B5E20",
    numeric: "#1565C0",
    bold: "#D81B60",
    link: "#0288D1",
    strike: "#BDBDBD",
    list: "#558B2F",
    en: "#3949AB",
    bracket: "#00897B"
  },
  dark: {
    vol: "#EF6B60",
    chapter: "#B58AE6",
    section: "#E0B341",
    h1: "#90A4AE",
    h2: "#A3B8C8",
    h3: "#B0BEC5",
    h4: "#C7D2DA",
    ordinalCircle: "#FFA726",
    ordinalParenNum: "#FF8A65",
    ordinalParenCn: "#A1887F",
    arrow: "#FF8A65",
    dash: "#757575",
    italic: "#B39DDB",
    meta: "#4DD0E1",
    metaKey: "#4DD0E1",
    metaValue: "#26A69A",
    ref: "#9E9E9E",
    blockquote: "#8D8D8D",
    book: "#F06292",
    quote: "#81C784",
    quoteDouble: "#A5D6A7",
    quoteBook: "#66BB6A",
    numeric: "#64A8E8",
    bold: "#F48FB1",
    link: "#4FC3F7",
    strike: "#757575",
    list: "#9CCC65",
    en: "#9FA8DA",
    bracket: "#4DB6AC"
  }
};
var activeThemes = {
  light: { ...THEMES.light },
  dark: { ...THEMES.dark }
};
function applyColorOverrides(overrides) {
  const o = overrides || {};
  activeThemes = {
    light: Object.assign({}, THEMES.light, o.light || {}),
    dark: Object.assign({}, THEMES.dark, o.dark || {})
  };
  return activeThemes;
}
function buildRules(t) {
  return [
    // ===== 行级规则（整行语义） =====
    { name: "vol", re: /^第[零一二三四五六七八九十百千0-9]+卷.*$/gm, style: { color: t.vol, bold: true, sizeDelta: 4 } },
    { name: "chapter", re: /^第[零一二三四五六七八九十百千0-9]+[回章节].*$/gm, style: { color: t.chapter, bold: true, sizeDelta: 2 } },
    // 小节标题：数字+空格（1 引言）。数字+点/顿号（1. 1、）走 orderedMark，避免混色
    { name: "numSection", re: /^\s*\d{1,3}[ \t]+[^\n]+$/gm, style: { color: t.section, bold: true } },
    { name: "bareSection", re: /^\s*(?:简介|序|序言|前言|目录|后记|附录|凡例|校注凡例|说明|摘要|导读)\s*$/gm, style: { color: t.section, bold: true } },
    // meta（行内）：任意位置出现「中文键：值」就染，不挑词（适配小说自创词）
    // key 限定为纯中文（1-16 字）：避免 `https://...` 里的 `https:` 被当成 meta 键，
    // 把 URL 之后的正文整段染成 metaValue（v2.0.5 修复）。
    // value = 冒号后到行尾（最长 200 字），不再被中文标点截断
    // 冒号后跟双引号（他说："…"）则失效：引号内容交给 quoteDouble（优先级最高）
    { name: "metaKey", re: /(?:^|[^\u4e00-\u9fff\w])([\u4e00-\u9fff]{1,16})(?=[：:](?!\s*["\u201C\u201D]))/gm, group: 1, style: { color: t.metaKey } },
    { name: "metaValue", re: /(?:^|[^\u4e00-\u9fff\w])([\u4e00-\u9fff]{1,16}[：:](?!\s*["\u201C\u201D])[^\n]{0,200})/gm, group: 1, style: { color: t.metaValue } },
    { name: "divider", re: /^\s*[=\-—─═*～~_]{6,}\s*$/gm, style: { color: t.ref } },
    // 标题：组 2 = 标题文字（组 1 是 # 标记，不染色）；颜色按 # 层级递进
    { name: "heading", re: /^(#{1,6})\s+(.+)$/gm, group: 2, style: (m, th) => {
      const lv = m[1].length;
      return { color: [th.h1, th.h2, th.h3, th.h4][lv - 1] ?? th.h4, bold: true, sizeDelta: lv <= 2 ? lv === 1 ? 4 : 2 : 0 };
    } },
    { name: "blockquote", re: /^\s*[>＞]\s?(.*)$/gm, group: 1, style: { color: t.blockquote } },
    // 斜体标注行（*设计原理：…、*专业术语：）：单星号开头（Obsidian 未闭合也渲染斜体）。
    // 组 1 = 整行内容；* 标记在组外天然不染色（=隐藏，与 #、**、~~ 同哲学）。
    // 排除 * 列表（* 后跟空格）与 ** 粗体（* 后跟星号）
    { name: "italicLine", re: /^\*(?!\s|\*)(.+)$/gm, group: 1, style: { color: t.italic } },
    { name: "listMark", re: /^\s*[-*+]\s/gm, style: { color: t.list, bold: true } },
    // 任务清单标记：整块原子（屏蔽 [x] 里的 x 被 en 染成英文色）；结尾空格可选，兼容行尾
    { name: "taskMark", re: /^\s*[-*+]\s\[[ xX]\]\s?/gm, atomic: true, style: { color: t.list, bold: true } },
    // 有序标记：支持 1. / 1、 / 1)（顿号后允许无空格，贴近中文打字）
    { name: "orderedMark", re: /^\s*\d{1,3}[.．、)]\s?/gm, style: { color: t.list, bold: true } },
    { name: "ordinal", re: /^\s*(?:[一二三四五六七八九十]{1,3}、|[（(][一二三四五六七八九十0-9]{1,3}[)）][、.．]?)/gm, style: { color: t.ordinalCircle, bold: true } },
    // ===== 行内规则 =====
    // 中文标点（《》「」『』""（））属于内容的一部分：整段染，不拆标记
    { name: "book", re: /《[^《》\n]{1,60}》/g, style: { color: t.book } },
    { name: "quoteDian", re: /「[^「」\n]{1,200}」/g, style: { color: t.quote } },
    { name: "quoteBook", re: /『[^『』\n]{1,200}』/g, style: { color: t.quoteBook } },
    { name: "quoteDouble", re: /“[^“”\n]{1,200}”|"[^"\n]{1,200}"/g, style: { color: t.quoteDouble } },
    { name: "ref", re: /[\[［]\d{1,3}[\]］]/g, style: { color: t.ref } },
    { name: "ordinalCircle", re: /[①-⑳]/g, style: { color: t.ordinalCircle } },
    { name: "ordinalParenNum", re: /[（(]\d{1,4}[）)]/g, style: { color: t.ordinalParenNum } },
    // 日期 / 时间：原子单元，整体一色，不被内部数字打碎
    { name: "date", re: /\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?/g, atomic: true, style: { color: t.numeric } },
    { name: "time", re: /\d{1,2}[:：]\d{2}/g, atomic: true, style: { color: t.numeric } },
    // 普通数字：边界排除标识符内数字（MD5 的 5 不染）与行首序号（1、1. 的 1 不染）
    { name: "num", re: /(?<![\d.\w])\d+(?:\.\d+)?%?(?![\d.\w、.．)）])/g, style: { color: t.numeric } },
    // 数字+拉丁单位（1970s、7.83Hz）：数字后直接跟字母时 num 会失手，这里整体一色
    { name: "numUnit", re: /(?<![\d.\w])\d+(?:\.\d+)?[A-Za-z]{1,5}(?![A-Za-z0-9])/g, style: { color: t.numeric } },
    // 结构连接符：流程箭头（→）与破折号（——），中文笔记高频字符
    { name: "arrow", re: /[→⇒]/g, style: { color: t.arrow } },
    { name: "dash", re: /—{2,}/g, style: { color: t.dash } },
    // 英文/拉丁标识符：独立染色（靛蓝），边界排除数字字母下划线
    { name: "en", re: /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9_.-]{0,19}(?![A-Za-z0-9_])/g, style: { color: t.en } },
    // markdown 标记：组 1 = 内容，** ~~ ` 不染色。priority -1（包裹规则）——
    // 与内容规则（书名号等）同坐标时，内容规则胜（颜色给内容），粗/删线仅保留
    { name: "bold", re: /\*\*([^*\n]+?)\*\*/g, group: 1, priority: -1, style: { color: t.bold, bold: true } },
    { name: "strike", re: /~~([^~\n]+?)~~/g, group: 1, priority: -1, style: { color: t.strike, strike: true } },
    { name: "inlineCode", re: /`([^`\n]+?)`/g, group: 1, style: { color: t.ref, mono: true } },
    // 链接 / 图片 / URL
    { name: "link", re: /\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)/g, style: { color: t.link } },
    { name: "wikiLink", re: /\[\[([^\]\n]{1,100})\]\]/g, group: 1, style: { color: t.link } },
    { name: "image", re: /!\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)/g, style: { color: t.link } },
    // 裸 URL 整体一色（link），屏蔽内部 en/num 染色，避免 URL 被拆成多色
    { name: "url", re: /https?:\/\/[^\s<>\n]{4,200}/g, atomic: true, style: { color: t.link } }
  ];
}
function detectContainers(text) {
  const skip = [];
  const tableRows = /* @__PURE__ */ new Map();
  const lines = text.split("\n");
  const FENCE = /^\s*(```|~~~)/;
  const T_SEP = /^\s*\|[\s:\-|]+\|\s*$/;
  const T_ROW = /^\s*\|.*\|\s*$/;
  const lineStart = [];
  {
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStart.push(off);
      off += lines[i].length + 1;
    }
  }
  let inFence = false, fenceStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      if (!inFence) {
        fenceStart = lineStart[i];
        inFence = true;
      } else {
        skip.push({ start: fenceStart, end: lineStart[i] + lines[i].length });
        inFence = false;
      }
    }
  }
  if (inFence) skip.push({ start: fenceStart, end: text.length });
  for (let i = 0; i < lines.length; i++) {
    if (T_SEP.test(lines[i]) && i > 0 && T_ROW.test(lines[i - 1])) {
      tableRows.set(i - 1, "header");
    }
  }
  return { skip, tableRows, lineStart, lines };
}
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
    stats() {
      return { hits, misses };
    }
  };
}
function collectSpans(text, theme, opts = {}) {
  const { winStart = 0, winEnd = text.length, ctx = null } = opts;
  const { skip, tableRows, lineStart, lines } = ctx ?? detectContainers(text);
  const inSkip = (idx) => {
    for (const s of skip) if (idx >= s.start && idx < s.end) return true;
    return false;
  };
  const spans = [];
  const slice = winStart === 0 && winEnd === text.length ? text : text.slice(winStart, winEnd);
  const off = winStart;
  for (const [i, kind] of tableRows) {
    if (kind !== "header") continue;
    const s = lineStart[i], e = s + lines[i].length;
    if (s >= winStart && e <= winEnd) spans.push({ start: s - off, end: e - off, color: theme.meta, bold: true });
  }
  for (const rule of buildRules(theme)) {
    const re = rule.re.flags.includes("d") ? rule.re : new RegExp(rule.re.source, rule.re.flags + "d");
    for (const m of slice.matchAll(re)) {
      if (inSkip(off + m.index)) continue;
      const st = typeof rule.style === "function" ? rule.style(m, theme) : rule.style;
      if (!st) continue;
      const seg = m.indices[rule.group ?? 0];
      if (!seg) continue;
      const [start, end] = seg;
      if (end <= start) continue;
      const span = { start, end, ...st };
      if (rule.atomic) span.atomic = true;
      if (rule.priority !== void 0) span.priority = rule.priority;
      spans.push(span);
    }
  }
  {
    const NL2 = String.fromCharCode(10, 10);
    const hasWord = (s) => {
      for (const ch of s) {
        const c = ch.codePointAt(0);
        if (c >= 19968 && c <= 40959 || c >= 65 && c <= 90 || c >= 97 && c <= 122) return true;
      }
      return false;
    };
    const pair = (opens, closes, color, needWord) => {
      const stack = [];
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        if (inSkip(off + i)) continue;
        if (opens.includes(ch)) {
          stack.push(i);
          continue;
        }
        if (closes.includes(ch)) {
          if (!stack.length) continue;
          const open = stack.pop();
          const inner = slice.slice(open + 1, i);
          if (inner.includes(NL2)) continue;
          if (needWord && !hasWord(inner)) continue;
          spans.push({ start: open, end: i + 1, color });
        }
      }
    };
    pair(["\uFF08", "("], ["\uFF09", ")"], theme.ordinalParenCn, true);
    pair(["\u3010"], ["\u3011"], theme.bracket, false);
  }
  return spans;
}
function synthesize(text, spans) {
  const len = text.length;
  const cut = /* @__PURE__ */ new Set([0, len]);
  for (const s of spans) {
    cut.add(Math.max(0, Math.min(len, s.start)));
    cut.add(Math.max(0, Math.min(len, s.end)));
  }
  for (let i = 0; i + 1 < len; i++) {
    if (text[i] === "\n" && text[i + 1] === "\n") {
      cut.add(i);
      cut.add(i + 2);
    }
  }
  const pts = [...cut].sort((a, b) => a - b);
  const byStart = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const byEnd = [...spans].sort((a, b) => a.end - b.end || a.start - b.start);
  const active = [];
  let si = 0, ei = 0;
  const tokens = [];
  let buf = "", cur = null, curKey = "";
  const keyOf = (s, bold, strike, mono, size) => `${s && s.color ? s.color : ""}|${bold ? 1 : 0}|${strike ? 1 : 0}|${mono ? 1 : 0}|${size || 0}`;
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
      cur = winner ? { color: winner.color, bold, strike, mono, sizeDelta: size || void 0 } : null;
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
function buildTokensIn(text, isDark, ctx, winStart, winEnd) {
  if (!text || winEnd <= winStart) return [];
  const theme = isDark ? activeThemes.dark : activeThemes.light;
  const slice = text.slice(winStart, winEnd);
  return synthesize(slice, collectSpans(text, theme, { winStart, winEnd, ctx }));
}
var SKIP_TAGS = /* @__PURE__ */ new Set(["CODE", "PRE", "SCRIPT", "STYLE", "INPUT", "TEXTAREA"]);
function setStyle(el, prop, val) {
  el.style.setProperty(prop, val, "important");
}
function readingProcessor(el) {
  const isDark = document.body.classList.contains("theme-dark");
  const t = isDark ? activeThemes.dark : activeThemes.light;
  const headingColor = { H1: t.h1, H2: t.h2, H3: t.h3, H4: t.h4, H5: t.h4, H6: t.h4 };
  for (const h of el.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const c = headingColor[h.tagName];
    if (c) {
      setStyle(h, "color", c);
      setStyle(h, "font-weight", "bold");
    }
  }
  for (const s of el.querySelectorAll("strong")) setStyle(s, "color", t.bold);
  for (const s of el.querySelectorAll("em")) setStyle(s, "color", t.italic);
  for (const th of el.querySelectorAll("th")) {
    setStyle(th, "color", t.meta);
    setStyle(th, "font-weight", "bold");
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName) || parent.classList.contains("inknote-hl")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  for (let n; n = walker.nextNode(); ) textNodes.push(n);
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
var editingPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.containers = createContainerCache();
      this.decorations = this.build(view);
      this._dark = document.body.classList.contains("theme-dark");
      this._epoch = themeEpoch;
    }
    update(u) {
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
      const ctx = this.containers.get(text);
      const deco = [];
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
module.exports = class InknoteHighlight extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({ colors: { light: {}, dark: {} } }, await this.loadData());
    if (!this.settings.colors) this.settings.colors = { light: {}, dark: {} };
    applyColorOverrides(this.settings.colors);
    this.registerMarkdownPostProcessor(readingProcessor);
    this.registerEditorExtension(editingPlugin);
    this.addSettingTab(new HighlightSettingsTab(this.app, this));
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
var COLOR_LABELS = {
  vol: "\u5377\u6807\u9898\uFF08\u7B2CX\u5377\uFF09",
  chapter: "\u7AE0\u8282\u6807\u9898\uFF08\u7B2CX\u56DE/\u7AE0/\u8282\uFF09",
  section: "\u5C0F\u8282 / \u56FA\u5B9A\u6807\u9898\uFF081 \u5F15\u8A00\u3001\u7B80\u4ECB\uFF09",
  h1: "\u6807\u9898 # \u4E00\u7EA7",
  h2: "\u6807\u9898 ## \u4E8C\u7EA7",
  h3: "\u6807\u9898 ### \u4E09\u7EA7",
  h4: "\u6807\u9898 #### \u56DB\u7EA7\u53CA\u4EE5\u4E0B",
  ordinalCircle: "\u5706\u5708\u5E8F\u53F7 \u2460",
  ordinalParenNum: "\u62EC\u53F7\u6570\u5B57\uFF081961\uFF09",
  ordinalParenCn: "\u4E2D\u6587\u62EC\u53F7\uFF08\uFF09",
  arrow: "\u7BAD\u5934 \u2192",
  dash: "\u7834\u6298\u53F7 \u2014\u2014",
  italic: "\u659C\u4F53\u6807\u6CE8\u884C *\u2026",
  meta: "\u8868\u683C\u8868\u5934",
  metaKey: "meta \u952E\uFF08\u4F5C\u8005\uFF09",
  metaValue: "meta \u503C\uFF08\uFF1A\u9C81\u8FC5\uFF09",
  ref: "\u53C2\u8003\u6587\u732E [1]",
  blockquote: "\u5F15\u7528\u884C >",
  book: "\u4E66\u540D\u53F7\u300A\u300B",
  quote: "\u5F15\u53F7\u300C\u300D",
  quoteDouble: "\u5F15\u53F7\u201C\u201D",
  quoteBook: "\u5F15\u53F7\u300E\u300F",
  numeric: "\u6570\u5B57 / \u65E5\u671F / \u65F6\u95F4",
  bold: "\u7C97\u4F53 **",
  link: "\u94FE\u63A5 / URL",
  strike: "\u5220\u9664\u7EBF ~~",
  list: "\u5217\u8868\u6807\u8BB0 -",
  en: "\u82F1\u6587 / \u62C9\u4E01\u6807\u8BC6\u7B26",
  bracket: "\u65B9\u62EC\u53F7\u3010\u3011"
};
var PREVIEW_TEXT = [
  "\u7B2C1\u5377 \u98CE\u8D77",
  "\u7B2C1\u7AE0 \u5F00\u7AEF",
  "1 \u5F15\u8A00",
  "\u7B80\u4ECB",
  "\u4F5C\u8005\uFF1A\u9C81\u8FC5",
  "---",
  "# \u4E00\u7EA7\u6807\u9898",
  "## \u4E8C\u7EA7\u6807\u9898",
  "### \u4E09\u7EA7\u6807\u9898",
  "#### \u56DB\u7EA7\u6807\u9898",
  "> \u5F15\u7528\u884C",
  "*\u659C\u4F53\u6807\u6CE8\u884C",
  "- \u5217\u8868\u9879",
  "- [x] \u4EFB\u52A1\u9879",
  "\u4E00\u3001\u4E2D\u6587\u5E8F\u53F7",
  "\u300A\u7EA2\u697C\u68A6\u300B\u300C\u5F15\u53F7\u300D\u300E\u4E66\u540D\u5F15\u53F7\u300F\u201C\u53CC\u5F15\u53F7\u201D",
  "[1] \u2460 \uFF081961\uFF09 \uFF08\u4E2D\u6587\u62EC\u53F7\uFF09",
  "2024-01-01 12:30 1970s 7.83Hz",
  "\u2192 \u2014\u2014",
  "**\u7C97\u4F53** ~~\u5220\u9664~~ `\u4EE3\u7801`",
  "[\u94FE\u63A5](https://example.com) [[wiki]]",
  "",
  "| \u8868\u5934 | \u8868\u5934 |",
  "|---|---|",
  "| \u6B63\u6587 | \u6B63\u6587 |"
].join("\n");
var COLOR_SAMPLES = {
  vol: "\u7B2C1\u5377 \u98CE\u8D77",
  chapter: "\u7B2C1\u7AE0 \u5F00\u7AEF",
  section: "1 \u5F15\u8A00",
  h1: "\u4E00\u7EA7\u6807\u9898",
  h2: "\u4E8C\u7EA7\u6807\u9898",
  h3: "\u4E09\u7EA7\u6807\u9898",
  h4: "\u56DB\u7EA7\u6807\u9898",
  ordinalCircle: "\u2460\u2461\u2462",
  ordinalParenNum: "\uFF081961\uFF09",
  ordinalParenCn: "\uFF08\u4E2D\u6587\u62EC\u53F7\uFF09",
  arrow: "\u2192 \u21D2",
  dash: "\u2014\u2014\u2014\u2014",
  italic: "*\u659C\u4F53\u6807\u6CE8\u884C",
  meta: "\u8868\u5934",
  metaKey: "\u4F5C\u8005",
  metaValue: "\uFF1A\u9C81\u8FC5",
  ref: "[1] [12]",
  blockquote: "> \u5F15\u7528\u884C",
  book: "\u300A\u7EA2\u697C\u68A6\u300B",
  quote: "\u300C\u5F15\u53F7\u300D",
  quoteDouble: "\u201C\u53CC\u5F15\u53F7\u201D",
  quoteBook: "\u300E\u4E66\u540D\u5F15\u53F7\u300F",
  numeric: "2024-01-01 1234 7.83Hz",
  bold: "\u7C97\u4F53",
  link: "[\u94FE\u63A5](url) https://a.b",
  strike: "\u5220\u9664\u7EBF",
  list: "- \u5217\u8868\u9879",
  en: "English ABC",
  bracket: "\u3010\u65B9\u62EC\u53F7\u3011"
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
    isDark ? "background: #1e1e1e; color: #dcdcdc" : "background: #ffffff; color: #222222"
  ].join("; ");
  const frag = document.createDocumentFragment();
  for (const tk of buildTokens(PREVIEW_TEXT, isDark)) {
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
var HighlightSettingsTab = class extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.previewEls = { light: null, dark: null };
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "\u5B9E\u65F6\u9884\u89C8" });
    const wrap = containerEl.createDiv();
    wrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;";
    for (const mode of ["light", "dark"]) {
      const box = wrap.createDiv();
      const label = box.createEl("div", { text: mode === "light" ? "\u4EAE\u8272\u4E3B\u9898" : "\u6697\u8272\u4E3B\u9898" });
      label.style.cssText = "font-weight:600;margin-bottom:6px;color:var(--text-muted);";
      const el = box.createDiv();
      this.previewEls[mode] = el;
    }
    this.refreshPreviews();
    for (const mode of ["light", "dark"]) {
      containerEl.createEl("h3", { text: mode === "light" ? "\u4EAE\u8272\u4E3B\u9898\u989C\u8272" : "\u6697\u8272\u4E3B\u9898\u989C\u8272" });
      const hint = containerEl.createEl("p", {
        text: "\u9010\u9879\u4FEE\u6539\uFF1B\u70B9\u51FB \u21BA \u6062\u590D\u8BE5\u9879\u9ED8\u8BA4\u503C\u3002\u4FEE\u6539\u4F1A\u7ACB\u5373\u5E94\u7528\u5230\u5DF2\u6253\u5F00\u7684\u7B14\u8BB0\u3002"
      });
      hint.style.color = "var(--text-muted)";
      this.renderColorGroup(containerEl, mode);
    }
    new obsidian.Setting(containerEl).setName("\u91CD\u7F6E\u5168\u90E8\u989C\u8272").setDesc("\u6E05\u7A7A\u6240\u6709\u81EA\u5B9A\u4E49\u989C\u8272\uFF0C\u6062\u590D\u5185\u7F6E\u914D\u8272\u3002").addButton((b) => b.setButtonText("\u5168\u90E8\u6062\u590D\u9ED8\u8BA4").onClick(async () => {
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
  renderColorGroup(parent, mode) {
    const defaults = THEMES[mode];
    const overrides = this.plugin.settings.colors[mode] || {};
    const isDark = mode === "dark";
    for (const key of Object.keys(defaults)) {
      let picker = null;
      const setting = new obsidian.Setting(parent).setName(COLOR_LABELS[key] || key);
      const sampleEl = setting.nameEl.createSpan({ cls: "inknote-color-sample" });
      sampleEl.style.cssText = "margin-left:12px;opacity:0.9;font-weight:normal;";
      const sample = COLOR_SAMPLES[key] || key;
      renderSample(sampleEl, sample, isDark);
      setting.addColorPicker((cp) => {
        picker = cp;
        cp.setValue(overrides[key] || defaults[key]).onChange(async (v) => {
          await this.applyChange(mode, key, v);
          renderSample(sampleEl, sample, isDark);
        });
      }).addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip("\u6062\u590D\u9ED8\u8BA4").onClick(async () => {
        await this.applyChange(mode, key, null);
        if (picker) picker.setValue(defaults[key]);
        renderSample(sampleEl, sample, isDark);
      }));
    }
  }
};
module.exports.__test = {
  THEMES,
  applyColorOverrides,
  getActiveThemes: () => activeThemes,
  buildRules,
  detectContainers,
  createContainerCache,
  collectSpans,
  synthesize,
  buildTokens,
  buildTokensIn
};

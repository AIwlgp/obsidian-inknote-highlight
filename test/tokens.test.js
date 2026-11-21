// 墨记中文结构高亮 v2 — 离线测试
// 运行：npm test（node --test test/）
//
// 只测纯逻辑（规则匹配 / 容器识别 / 合成器 / 容器缓存），不依赖 Obsidian 运行时。
// 通过 mock 'obsidian' 与 '@codemirror/view' 后直接加载 src/main.js。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// --- mock 第三方模块（必须在 require 插件源码之前） ---
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class Plugin {} };
  if (request === '@codemirror/view') {
    return {
      ViewPlugin: { fromClass: (cls) => cls },
      Decoration: { mark: () => ({ range: () => ({}) }), set: () => ({}) },
      EditorView: {},
    };
  }
  return origLoad.apply(this, arguments);
};

const T = require('../src/main.js').__test;
const L = T.THEMES.light;
const D = T.THEMES.dark;

function tokens(text, dark = false) {
  return T.buildTokens(text, dark);
}
function styled(text, dark = false) {
  return tokens(text, dark).filter((tk) => tk.color || tk.bold || tk.strike || tk.mono || tk.sizeDelta);
}
function joined(text, dark = false) {
  return tokens(text, dark).map((tk) => tk.text).join('');
}

// ---------- 基础：不丢字符 ----------

test('buildTokens 切分后重组 == 原文', () => {
  const src = '第1章 风起时，《红楼梦》与 1970s。';
  assert.strictEqual(joined(src), src);
});

test('空文本返回空数组', () => {
  assert.deepStrictEqual(T.buildTokens('', false), []);
});

// ---------- 行内规则 ----------

test('书名号染色', () => {
  const t = styled('《红楼梦》');
  assert.ok(t.some((x) => x.text === '《红楼梦》' && x.color === L.book));
});

test('粗体书名号：颜色归书名号，粗体保留（v2.0.4 回归）', () => {
  const hit = styled('**《红楼梦》**').find((x) => x.text === '《红楼梦》');
  assert.ok(hit, '应存在《红楼梦》token');
  assert.strictEqual(hit.color, L.book);
  assert.ok(hit.bold, '粗体属性应保留');
});

test('行内代码不会被英文规则抢色', () => {
  const hit = styled('调用 `read_file` 一下').find((x) => x.text === 'read_file');
  assert.ok(hit);
  assert.strictEqual(hit.color, L.ref);
  assert.ok(hit.mono);
});

test('URL 之后正文不被 meta 染色（v2.0.5 回归）', () => {
  const t = styled('见 https://example.com/a/1 谢谢');
  assert.ok(!t.some((x) => x.color === L.metaValue), 'URL 之后不应出现 metaValue 色');
  assert.ok(t.some((x) => x.text.startsWith('https://') && x.color === L.link));
});

test('URL 内部的冒号不触发 metaKey/metaValue', () => {
  const t = styled('https://example.com');
  assert.ok(!t.some((x) => x.color === L.metaKey || x.color === L.metaValue));
});

test('正常 meta 键值仍生效（作者：鲁迅）', () => {
  const t = styled('作者：鲁迅');
  assert.ok(t.some((x) => x.text === '作者'));
  assert.ok(t.some((x) => x.text.startsWith('：鲁迅') || x.text === '：鲁迅'));
});

test('MD5 不被数字规则拆开', () => {
  const t = styled('MD5 摘要');
  assert.ok(t.some((x) => x.text === 'MD5' && x.color === L.en));
  assert.ok(!t.some((x) => x.text === '5' && x.color === L.numeric));
});

test('中文括号数字走 ordinalParenNum', () => {
  assert.ok(styled('（2024）年').some((x) => x.text === '（2024）' && x.color === L.ordinalParenNum));
});

test('粗体标记字符不被染色（组 1 外）', () => {
  const t = styled('**重要**');
  assert.ok(t.some((x) => x.text === '重要' && x.bold));
  assert.ok(!t.some((x) => x.text.includes('**')), '** 标记不应出现在有样式的 token 里');
});

test('深色主题取深色色板', () => {
  const t = styled('《红楼梦》', true);
  assert.ok(t.some((x) => x.text === '《红楼梦》' && x.color === D.book));
});

// ---------- 容器 ----------

test('代码围栏内不染色', () => {
  const src = ['```', '《红楼梦》 1970s', '```', '正文'].join('\n');
  const t = styled(src);
  assert.ok(!t.some((x) => x.color === L.book), '围栏内书名号不应被染色');
});

test('未闭合围栏：后续内容全部跳过', () => {
  const src = ['```js', '《红楼梦》'].join('\n');
  const ctx = T.detectContainers(src);
  assert.strictEqual(ctx.skip.length, 1);
  assert.strictEqual(ctx.skip[0].end, src.length);
});

test('detectContainers 识别代码围栏与表格表头', () => {
  const src = ['```js', 'a', '```', '| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
  const ctx = T.detectContainers(src);
  assert.strictEqual(ctx.skip.length, 1);
  assert.strictEqual(ctx.tableRows.get(3), 'header');
});

test('表格表头染 meta 色', () => {
  const src = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
  const t = styled(src);
  assert.ok(t.some((x) => x.color === L.meta && x.bold), '表头应有 meta 色 + 粗体');
});

// ---------- 容器缓存 ----------

test('容器缓存：同一文本第二次起命中', () => {
  const cache = T.createContainerCache();
  const text = 'a\nb\nc';
  cache.get(text);
  cache.get(text);
  cache.get(text);
  assert.deepStrictEqual(cache.stats(), { hits: 2, misses: 1 });
});

test('容器缓存：文本变化后未命中', () => {
  const cache = T.createContainerCache();
  cache.get('a');
  cache.get('a\nb');
  assert.deepStrictEqual(cache.stats(), { hits: 0, misses: 2 });
});

test('容器缓存命中结果与全量扫描一致', () => {
  const text = ['```', 'x', '```', '| A |', '|---|'].join('\n');
  const cache = T.createContainerCache();
  const a = cache.get(text);
  const b = cache.get(text);
  assert.strictEqual(a, b, '应复用同一对象');
  assert.deepStrictEqual(a.skip, T.detectContainers(text).skip);
});

// ---------- 合成器 ----------

test('最内层决定颜色：粗体里的链接保留粗体、颜色归链接', () => {
  const t = styled('**[文档](https://x.com)**');
  const linkToken = t.find((x) => x.text.includes('https://x.com') || x.text.includes('文档'));
  assert.ok(linkToken);
});

test('synthesize 输出按序覆盖全文', () => {
  const text = '《甲》和「乙」';
  const spans = T.collectSpans(text, L);
  const out = T.synthesize(text, spans);
  assert.strictEqual(out.map((x) => x.text).join(''), text);
});

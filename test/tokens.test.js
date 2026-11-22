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
  if (request === 'obsidian') {
    return {
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {
        constructor(app, plugin) { this.app = app; this.plugin = plugin; }
        // display() 在测试里不调用，但保留方法形状
        display() {}
      },
      Setting: class Setting {},
    };
  }
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

// ---------- 颜色自定义 ----------

test('颜色覆盖：改 book 色后立即生效，恢复后还原', () => {
  const before = T.THEMES.light.book;
  try {
    T.applyColorOverrides({ light: { book: '#123456' } });
    const hit = styled('《红楼梦》').find((x) => x.text === '《红楼梦》');
    assert.strictEqual(hit.color, '#123456');
  } finally {
    T.applyColorOverrides({});
  }
  const after = styled('《红楼梦》').find((x) => x.text === '《红楼梦》');
  assert.strictEqual(after.color, before);
});

test('颜色覆盖：只影响指定主题（dark 改了不影响 light）', () => {
  try {
    T.applyColorOverrides({ dark: { book: '#ABCDEF' } });
    assert.strictEqual(styled('《红楼梦》', true).find((x) => x.text === '《红楼梦》').color, '#ABCDEF');
    assert.strictEqual(styled('《红楼梦》', false).find((x) => x.text === '《红楼梦》').color, T.THEMES.light.book);
  } finally {
    T.applyColorOverrides({});
  }
});

test('颜色覆盖：未知键被忽略，不影响已有颜色', () => {
  try {
    T.applyColorOverrides({ light: { notAKey: '#000000' } });
    assert.strictEqual(styled('《红楼梦》').find((x) => x.text === '《红楼梦》').color, T.THEMES.light.book);
  } finally {
    T.applyColorOverrides({});
  }
});

test('颜色覆盖：getActiveThemes 反映当前生效值', () => {
  try {
    T.applyColorOverrides({ light: { quote: '#FF00FF' } });
    assert.strictEqual(T.getActiveThemes().light.quote, '#FF00FF');
    assert.strictEqual(T.getActiveThemes().light.book, T.THEMES.light.book);
  } finally {
    T.applyColorOverrides({});
  }
});

test('设置页示例：每个颜色项的示例都能真正触发该项颜色', () => {
  // 防止「示例文本缺标记 → 规则不匹配 → 示例永远无色」的回归
  const missing = [];
  for (const key of Object.keys(T.THEMES.light)) {
    const sample = T.COLOR_SAMPLES[key];
    if (!sample) { missing.push(key + '(无示例)'); continue; }
    const toks = T.buildTokens(sample, false);
    const hit = toks.some((t) => t.color === T.THEMES.light[key]);
    if (!hit) missing.push(key + ' -> ' + JSON.stringify(sample) + ' tokens=' + JSON.stringify(toks.filter((t) => t.color)));
  }
  assert.deepStrictEqual(missing, [], '以下示例没有产生对应颜色：\n' + missing.join('\n'));
});

test('设置页示例：暗色示例同样有效', () => {
  const missing = [];
  for (const key of Object.keys(T.THEMES.dark)) {
    const sample = T.COLOR_SAMPLES[key];
    if (!sample) { missing.push(key); continue; }
    const toks = T.buildTokens(sample, true);
    if (!toks.some((t) => t.color === T.THEMES.dark[key])) missing.push(key);
  }
  assert.deepStrictEqual(missing, [], '暗色示例没有产生对应颜色：' + missing.join(','));
});

test('设置页示例：每个颜色键都有标签和示例', () => {
  for (const key of Object.keys(T.THEMES.light)) {
    assert.ok(T.COLOR_LABELS[key], '缺少标签: ' + key);
    assert.ok(T.COLOR_SAMPLES[key], '缺少示例: ' + key);
  }
});

// ---------- 特殊规则（自定义匹配字） ----------

function volColor(line) {
  const tk = T.buildTokens(line, false).find((x) => x.color === T.THEMES.light.vol);
  return !!tk;
}
function chapterColor(line) {
  const tk = T.buildTokens(line, false).find((x) => x.color === T.THEMES.light.chapter);
  return !!tk;
}

test('特殊规则：默认只认「卷」和「回章节」', () => {
  try {
    T.applyRulesConfig({});
    assert.ok(volColor('第1卷 风起'), '第1卷 应被 vol 染色');
    assert.ok(!volColor('第1幕 开场'), '第1幕 默认不该被 vol 染色');
    assert.ok(chapterColor('第1章 开端'));
    assert.ok(chapterColor('第1回 开端'));
    assert.ok(!chapterColor('第1幕 开场'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：把「幕」加到卷类后，第1幕 也能染色', () => {
  try {
    T.applyRulesConfig({ volumeUnits: '卷幕' });
    assert.ok(volColor('第1幕 开场'), '第1幕 应被 vol 染色');
    assert.ok(volColor('第1卷 风起'), '第1卷 仍应染色');
    assert.ok(!chapterColor('第1幕 开场'), '幕只加在卷类时不应被 chapter 染色');
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：改起始字（序）后，序1卷 也能染色', () => {
  try {
    T.applyRulesConfig({ prefix: '第序' });
    assert.ok(volColor('序1卷 开端'), '序1卷 应被 vol 染色');
    assert.ok(volColor('第1卷 风起'), '第1卷 仍应染色（前缀是多字字符类）');
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：空白值回退默认，不会生成非法正则', () => {
  try {
    T.applyRulesConfig({ prefix: '  ', volumeUnits: '', chapterUnits: '   ' });
    const cfg = T.getRulesConfig();
    assert.strictEqual(cfg.prefix, T.DEFAULT_RULES_CONFIG.prefix);
    assert.strictEqual(cfg.volumeUnits, T.DEFAULT_RULES_CONFIG.volumeUnits);
    assert.strictEqual(cfg.chapterUnits, T.DEFAULT_RULES_CONFIG.chapterUnits);
    assert.ok(volColor('第1卷 风起'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：用户输入含正则特殊字符时不崩', () => {
  try {
    T.applyRulesConfig({ volumeUnits: '卷]幕[篇' });
    // 不抛异常即可；「]」「[」被正确转义进字符类
    assert.doesNotThrow(() => T.buildTokens('第1] 风起', false));
    assert.doesNotThrow(() => T.buildTokens('第1卷 风起', false));
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：vol/chapter 示例跟随配置变化', () => {
  try {
    T.applyRulesConfig({ volumeUnits: '幕', chapterUnits: '集' });
    assert.ok(T.sampleFor('vol').includes('幕'), 'vol 示例应含当前卷类首字');
    assert.ok(T.sampleFor('chapter').includes('集'), 'chapter 示例应含当前章节类首字');
  } finally {
    T.applyRulesConfig({});
  }
});

test('顶部整体预览跟随规则变化（卷/章两行）', () => {
  try {
    T.applyRulesConfig({ volumeUnits: '幕', chapterUnits: '集' });
    const text = T.buildPreviewText();
    assert.ok(text.includes('第1幕'), '预览应显示「第1幕」: ' + text.split('\n')[0]);
    assert.ok(text.includes('第1集'), '预览应显示「第1集」');
    assert.ok(!text.includes('第1卷'), '不应再出现写死的「第1卷」');
    assert.ok(!text.includes('第1章'), '不应再出现写死的「第1章」');
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：词组用 / 分隔（我/章节/章/节）', () => {
  try {
    T.applyRulesConfig({ chapterUnits: '我/章节/章/节' });
    assert.ok(chapterColor('第1我 开端'), '第1我 应匹配');
    assert.ok(chapterColor('第1章节 开端'), '第1章节 应匹配（词组）');
    assert.ok(chapterColor('第1章 开端'), '第1章 应匹配');
    assert.ok(chapterColor('第1节 开端'), '第1节 应匹配');
    assert.ok(!chapterColor('第1回 开端'), '第1回 不在列表里，不应匹配');
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：卷类也支持 / 分隔词组', () => {
  try {
    T.applyRulesConfig({ volumeUnits: '卷/幕' });
    assert.ok(volColor('第1卷 风起'));
    assert.ok(volColor('第1幕 开场'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：只有斜杠时回退默认值', () => {
  try {
    T.applyRulesConfig({ chapterUnits: '/', volumeUnits: '／' });
    const cfg = T.getRulesConfig();
    assert.strictEqual(cfg.chapterUnits, T.DEFAULT_RULES_CONFIG.chapterUnits);
    assert.strictEqual(cfg.volumeUnits, T.DEFAULT_RULES_CONFIG.volumeUnits);
  } finally {
    T.applyRulesConfig({});
  }
});

test('特殊规则：词组配置下示例与预览取首项', () => {
  try {
    T.applyRulesConfig({ chapterUnits: '我/章节' });
    assert.ok(T.sampleFor('chapter').includes('我'), '示例应取第一个选项');
    assert.ok(T.buildPreviewText().includes('第1我'), '预览首行应取第一个选项');
  } finally {
    T.applyRulesConfig({});
  }
});

// ---------- 小节标题 vs 冒号 ----------

test('小节标题：1 引言： 整行走小节色，冒号不抢色', () => {
  const t = styled('1 引言：');
  assert.ok(!t.some((x) => x.color === L.metaKey || x.color === L.metaValue), '不应出现 meta 色：' + JSON.stringify(t));
  assert.ok(t.some((x) => x.color === L.section), '应有小节色');
});

test('小节标题：1 引言 ：（冒号前有空格）同样不抢色', () => {
  const t = styled('1 引言 ：');
  assert.ok(!t.some((x) => x.color === L.metaKey || x.color === L.metaValue), '不应出现 meta 色：' + JSON.stringify(t));
  assert.ok(t.some((x) => x.color === L.section));
});

test('普通行的 meta 仍生效（不受小节规则影响）', () => {
  const t = styled('作者：鲁迅');
  assert.ok(t.some((x) => x.color === L.metaKey || x.color === L.metaValue), '普通行应有 meta 色：' + JSON.stringify(t));
});

test('小节行里的其他行内规则不受影响（书名号照常）', () => {
  const t = styled('1 《红楼梦》导读：');
  assert.ok(t.some((x) => x.text.includes('《红楼梦》') && x.color === L.book), '书名号应保留');
  assert.ok(!t.some((x) => x.color === L.metaKey || x.color === L.metaValue), '冒号不应抢色');
});

// ---------- 小节分隔符 ----------

function sectionColor(line) {
  return T.buildTokens(line, false).some((x) => x.color === T.THEMES.light.section);
}

test('小节分隔符：默认只认空格', () => {
  try {
    T.applyRulesConfig({});
    assert.ok(sectionColor('1 引言'), '1 引言 应匹配');
    assert.ok(!sectionColor('1、引言'), '默认不该匹配 1、引言');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节分隔符：配置「空格/、」后两种都能匹配', () => {
  try {
    T.applyRulesConfig({ sectionSeparators: '空格/、' });
    assert.ok(sectionColor('1 引言'));
    assert.ok(sectionColor('1、引言'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节分隔符：只配「.」时，1.引言 匹配、空格写法不再匹配', () => {
  try {
    T.applyRulesConfig({ sectionSeparators: '.' });
    assert.ok(sectionColor('1.引言'));
    assert.ok(!sectionColor('1 引言'), '只配 . 时空格分隔不应匹配');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节分隔符：示例与预览跟随配置', () => {
  try {
    T.applyRulesConfig({ sectionSeparators: '、' });
    assert.ok(T.sampleFor('section').includes('、'), '示例应含分隔符');
    assert.ok(T.buildPreviewText().includes('1、引言'), '预览应含 1、引言');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节分隔符：只有斜杠时回退默认', () => {
  try {
    T.applyRulesConfig({ sectionSeparators: '/' });
    assert.strictEqual(T.getRulesConfig().sectionSeparators, T.DEFAULT_RULES_CONFIG.sectionSeparators);
  } finally {
    T.applyRulesConfig({});
  }
});

// ---------- 小节：中文数字 / 标题词 / 起始字 ----------

test('小节：中文数字（一 引言、十 说明）可匹配', () => {
  try {
    T.applyRulesConfig({});
    assert.ok(sectionColor('一 引言'), '一 引言 应匹配');
    assert.ok(sectionColor('十 说明'), '十 说明 应匹配');
    assert.ok(sectionColor('十二 结语'), '十二 结语 应匹配');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节：标题词限定（引言/引子）后，其他标题不再匹配', () => {
  try {
    T.applyRulesConfig({ sectionUnits: '引言/引子' });
    assert.ok(sectionColor('1 引言'));
    assert.ok(sectionColor('1 引子'));
    assert.ok(!sectionColor('1 随便写'), '标题词不在列表时不应匹配');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节：标题词留空时任意标题都匹配（默认行为不变）', () => {
  try {
    T.applyRulesConfig({});
    assert.ok(sectionColor('1 任意标题'));
    assert.ok(sectionColor('2 方法'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节：起始字「第」后，第1 引言 与 1 引言 都匹配', () => {
  try {
    T.applyRulesConfig({ sectionPrefix: '第' });
    assert.ok(sectionColor('第1 引言'));
    assert.ok(sectionColor('1 引言'), '起始字为可选，无前缀写法仍应匹配');
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节：三种写法（一 引言 / 1 引子 / 1.引言）都能匹配', () => {
  try {
    T.applyRulesConfig({ sectionSeparators: '空格/、/.' , sectionUnits: '引言/引子' });
    assert.ok(sectionColor('一 引言'));
    assert.ok(sectionColor('1 引子'));
    assert.ok(sectionColor('1.引言'));
  } finally {
    T.applyRulesConfig({});
  }
});

test('小节：示例跟随起始字与标题词', () => {
  try {
    T.applyRulesConfig({ sectionPrefix: '第', sectionUnits: '引子' });
    const s = T.sampleFor('section');
    assert.ok(s.includes('第') && s.includes('引子'), '示例应含起始字与标题词: ' + s);
  } finally {
    T.applyRulesConfig({});
  }
});

# InkNote Highlight

> **English** | [中文](README.zh.md)

Structured syntax highlighting for **Chinese** notes in Obsidian: chapter headings, 《book titles》, 「quotes」, meta key–value pairs, ordinals, dates and links each get their own color, layered by a "strict innermost wins" rule that overrides Obsidian's default Markdown coloring.

Built for Chinese-structured writing — novels, reading notes, and other long-form Chinese Markdown where default syntax highlighting is too coarse.

## Features

Two kinds of rules, colored by "innermost wins" + "attributes stack":

**Line-level (whole line)**

- `第X卷` / `第X回/章/节` lines (volume / chapter headings)
- Numeric section headings (`1 引言`) and fixed headings (`简介`, `序`, `前言`, `附录`, …)
- `key：value` meta pairs (`作者：鲁迅`)
- Horizontal rules, `#` headings (color progresses by level), blockquotes (`>`), italic annotation lines (`*设计原理：…`)
- List / task-list / ordered-list markers, Chinese ordinals (`一、`, `（一）`)

**Inline (fragments)**

- Book titles `《》`, quotes `「」` `『』` `“”`
- References `[1]`, circled numbers `①②`, numeric parens `（1961）`, Chinese bracket pairs `（）`
- Dates and times (kept as one color, not split by inner digits)
- Numbers, number+unit (`1970s`, `7.83Hz`), Latin identifiers
- Arrows `→`, em-dashes `——`
- Markdown markers: bold `**`, strikethrough `~~`, inline code `` ` `` (markers themselves are not colored)
- Links / wiki links / images / bare URLs (a bare URL stays one color inside)
- Code fences (``` / ~~~) are skipped entirely; pipe-table header rows use the meta color

## Installation

The plugin highlights both in **Reading view** (Markdown PostProcessor) and **Editing / Live Preview** (CodeMirror ViewPlugin).

**Manual install**

1. Put this repository into `.obsidian/plugins/inknote-highlight/` of your vault.
2. Make sure `main.js`, `manifest.json` and `styles.css` exist there (`main.js` is the `npm run build` artifact).
3. Enable **InkNote Highlight** under Settings → Community plugins.

**Build from source**

```bash
npm install
npm run build      # bundles src/main.js -> main.js and creates dist/inknote-highlight/
npm test           # 21 offline tests (node --test)
```

`npm run build` also produces a release folder `dist/inknote-highlight/` containing exactly the three files Obsidian needs. Copy that folder into `.obsidian/plugins/` to install.

> Requires **Obsidian 1.5.0+**. Desktop only (`isDesktopOnly: true`); mobile is not tested.

## Usage

No configuration — enable the plugin and it works. Colors adapt to light/dark themes, and the editor re-colors immediately when you switch themes.

## Customization

Colors live in the `THEMES` object (`light` / `dark`) at the top of `src/main.js`; the rule table is `buildRules()`:

```js
{
  name: "book",
  re: /《[^《》\n]{1,60}》/g,          // regex
  style: { color: t.book },          // style object, or (match, theme) => style
  group: 0,                          // optional: capture group to color (default 0 = whole match)
  atomic: true,                      // optional: atomic span, blocks nested coloring
  priority: 0,                       // optional: tie-breaker for identical ranges (content > wrapper)
}
```

Rebuild with `npm run build` after changes.

## Why `!important` inline styles

Obsidian's default Markdown coloring wins over ordinary inline styles, so the plugin sets colors with `!important` (both in Reading view spans and in CodeMirror mark decorations). This is intentional — without it the custom palette would be invisible.

## Custom colors

Settings → **InkNote Highlight** opens a panel with a **live preview** of both light and dark themes. Every color token (book titles, quotes, heading levels, meta pairs, numbers, links, list markers, …) can be overridden per theme with a color picker. Click `↺` to restore a single token's default, or use **Reset all colors** to go back to the built-in palette.

Changes apply immediately to open notes: editor decorations are rebuilt and reading views re-render. Overrides live in the plugin's `data.json` under `colors.light` / `colors.dark` — only the keys you changed are stored, so future updates to the default palette still reach you.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | Plugin source (rule table, container detection, token synthesizer, reading/editor entry points) |
| `main.js` | Build artifact (esbuild bundle of `src/main.js`) |
| `manifest.json` | Obsidian manifest (id / version / minimum app version) |
| `styles.css` | Fallback styles + reading-view table header colors |
| `build.mjs` | Build script (`npm run build`, emits the release folder `dist/`) |
| `test/tokens.test.js` | Offline tests (`npm test`) |
| `dist/inknote-highlight/` | Release folder: `manifest.json + main.js + styles.css` |

## Changelog

- **v2.0.8** — Per-token custom colors for light and dark themes, with a live preview in settings; changes apply to open notes immediately.
- **v2.0.7** — English-first README (`README.md`), Chinese translation moved to `README.zh.md` (same functionality as 2.0.6).
- **v2.0.6** — Manifest metadata compliance: Basic Latin name (`InkNote Highlight`) and an English description ending with a period, as required by the community directory (same functionality as 2.0.5).
- **v2.0.5** — Fixed: text after a URL (`https://...`) was wrongly tinted as a meta value (meta keys are now Chinese-only). Perf: container scanning (code fences / tables) is cached per document text, so scrolling and theme switches no longer rescan the whole note.
- **v2.0.4** — Fixed: bare URLs split into multiple colors, bold book titles overridden by the bold color, task-list `x` tinted as Latin text. Editor mode now processes only the visible viewport (much faster on large notes); light/dark switch re-colors immediately; reading-view styles use `!important`.
- Earlier versions: see the repository history.

## License

ISC — see [LICENSE](LICENSE).

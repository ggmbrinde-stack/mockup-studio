#!/usr/bin/env node
/* Offline check: every id and class the stylesheet targets should still exist.

   The panel has been through several layout passes, and each one left rules behind
   that matched markup which no longer existed (a footer the mini state hides, an
   actions row that became conditional). Those are invisible in screenshots and in
   the other suites, so this walks css/style.css and asks: does anything in the
   project actually carry this id or class?

   Universe = ids/classes in index.html plus every word that appears inside a
   string literal in the project's JS/JSX (that is where runtime-built markup,
   classList toggles and composed class names live).

   Run: node tools/verify-css.cjs
*/
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'css', 'style.css');
const htmlPath = path.join(root, 'index.html');

/* Names the code composes at runtime, so they never appear as a whole literal:
   "status tone-" + tone  and  "mode-" + mode. */
const COMPOSED = {
  'tone-accent': 'composed as "status tone-" + STATUS_TONE value',
  'tone-success': 'composed as "status tone-" + STATUS_TONE value',
  'tone-danger': 'composed as "status tone-" + STATUS_TONE value',
  'tone-warning': 'composed as "status tone-" + STATUS_TONE value',
  'mode-full': 'composed as "mode-" + mode',
  'mode-mini': 'composed as "mode-" + mode'
};

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function collectHtml() {
  const html = readText(htmlPath);
  const ids = new Set();
  const classes = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/\bclass="([^"]*)"/g)) {
    m[1].split(/\s+/).forEach(function (c) { if (c) classes.add(c); });
  }
  return { ids: ids, classes: classes };
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.charAt(0) === '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/* String literals, read with a small scanner rather than a quote-pair regex: adjacent
   literals (`+ " " : "") + "windowMode"`) defeat naive pairing and hide the very
   names this check exists to find. Comments are skipped. */
function stringLiterals(text) {
  const out = [];
  let i = 0;
  let quote = null;
  let start = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) { out.push(text.slice(start, i)); quote = null; }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch; start = i + 1; i++; continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    i++;
  }
  return out;
}

/* Every word inside a quoted literal counts: that covers createElement markup,
   className strings, classList.toggle('canCancel'), core.$("id") and friends. */
function collectCodeWords() {
  const words = new Set();
  const files = walk(root, []).filter(function (f) { return f !== htmlPath; });
  for (const file of files) {
    for (const literal of stringLiterals(readText(file))) {
      const parts = literal.split(/[^A-Za-z0-9_-]+/);
      for (const p of parts) if (p) words.add(p);
    }
  }
  return words;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* Returns [{ selector, body }] for style rules, descending into @media/@supports. */
function parseRules(text) {
  const rules = [];
  function walkBlock(chunk) {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf('{', i);
      if (open === -1) break;
      const selector = chunk.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < chunk.length && depth > 0) {
        const ch = chunk[j];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        j++;
      }
      const body = chunk.slice(open + 1, j - 1);
      if (selector.charAt(0) === '@') {
        if (/^@(media|supports)\b/.test(selector)) walkBlock(body);
      } else if (selector) {
        rules.push({ selector: selector, body: body });
      }
      i = j;
    }
  }
  walkBlock(text);
  return rules;
}

function check() {
  const html = collectHtml();
  const words = collectCodeWords();
  const knownId = function (id) { return html.ids.has(id) || words.has(id); };
  const knownClass = function (cls) {
    return html.classes.has(cls) || words.has(cls) || Object.prototype.hasOwnProperty.call(COMPOSED, cls);
  };

  const rules = parseRules(stripComments(readText(cssPath)));
  const missing = [];
  let checkedIds = 0;
  let checkedClasses = 0;

  for (const rule of rules) {
    for (const part of rule.selector.split(',')) {
      const sel = part.trim();
      if (!sel) continue;
      for (const m of sel.matchAll(/#([A-Za-z][\w-]*)/g)) {
        checkedIds++;
        if (!knownId(m[1])) missing.push({ kind: 'id', name: m[1], selector: sel });
      }
      for (const m of sel.matchAll(/\.([A-Za-z][\w-]*)/g)) {
        checkedClasses++;
        if (!knownClass(m[1])) missing.push({ kind: 'class', name: m[1], selector: sel });
      }
    }
  }

  const seen = new Set();
  const unique = missing.filter(function (m) {
    const key = m.kind + ':' + m.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length) {
    console.log('css selectors that match nothing:');
    for (const m of unique) {
      console.log('  ' + m.kind + ' ' + m.name + '   (in "' + m.selector + '")');
    }
    console.log('\n' + unique.length + ' dead selector(s). Remove the rule, or add the name to ' +
      'COMPOSED if the code builds it at runtime.');
    process.exit(1);
  }

  console.log('  ok   ' + checkedIds + ' id references and ' + checkedClasses +
    ' class references in css/style.css all resolve');
  console.log('\nAll checks passed.');
}

check();

/* Checks the vectorizer.ai export-options mapping without a browser.
   Run: node tools/verify-export-options.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xo = require('../agent/vectorizer/export-options');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}
function field(writes, name) {
  return writes.filter(w => w.names.indexOf(name) >= 0)[0];
}

console.log('export options:');

check('defaults match the site general preset', () => {
  const o = xo.normalize({});
  assert.strictEqual(o.preset, 'general');
  assert.strictEqual(o.draw, 'fill_shapes');
  assert.strictEqual(o.stack, 'cutouts');
  assert.strictEqual(o.group, 'none');
  assert.strictEqual(o.nativeShapes, true);
  assert.strictEqual(o.gapFiller, true);
  assert.strictEqual(o.svgVersion, 'svg_1_1');
});

check('presets fill their fields', () => {
  const editing = xo.normalize({ preset: 'editing' });
  assert.strictEqual(editing.stack, 'stacked');
  assert.strictEqual(editing.group, 'color');
  assert.strictEqual(editing.gapFiller, false);
  const cutting = xo.normalize({ preset: 'cutting' });
  assert.strictEqual(cutting.draw, 'stroke_edges');
  assert.strictEqual(cutting.gapFiller, false);
});

check('a preset still accepts an explicit override', () => {
  const o = xo.normalize({ preset: 'general', gapFiller: false, group: 'layer' });
  assert.strictEqual(o.gapFiller, false);
  assert.strictEqual(o.group, 'layer');
});

check('unknown values fall back instead of reaching the page', () => {
  const o = xo.normalize({ draw: 'nonsense', group: 42, svgVersion: 'svg_9', strokeWidth: 'abc' });
  assert.strictEqual(o.draw, 'fill_shapes');
  assert.strictEqual(o.group, 'none');
  assert.strictEqual(o.svgVersion, 'svg_1_1');
  assert.strictEqual(o.strokeWidth, 1);
});

check('stroke width is clamped to the documented 0..5', () => {
  assert.strictEqual(xo.normalize({ strokeWidth: 12 }).strokeWidth, 5);
  assert.strictEqual(xo.normalize({ strokeWidth: -3 }).strokeWidth, 0);
  assert.strictEqual(xo.normalize({ strokeWidth: 2.5 }).strokeWidth, 2.5);
});

check('adobe mode restricts curves to cubic', () => {
  const o = xo.normalize({ adobe: true, curves: 'all' });
  assert.strictEqual(o.curves, 'cubic');
  const w = xo.buildFieldWrites(o);
  assert.strictEqual(field(w, 'ui.svg_version_mode').value, 'adobe');
  assert.strictEqual(field(w, 'curves.allowed.quadratic_bezier').value, 'false');
  assert.strictEqual(field(w, 'curves.allowed.circular_arc').value, 'false');
  assert.strictEqual(field(w, 'curves.allowed.cubic_bezier').value, 'true');
});

check('curves=all keeps arcs and quadratics', () => {
  const w = xo.buildFieldWrites({ curves: 'all' });
  assert.strictEqual(field(w, 'curves.allowed.quadratic_bezier').value, 'true');
  assert.strictEqual(field(w, 'curves.allowed.elliptical_arc').value, 'true');
});

check('native shapes invert the flatten flag', () => {
  const on = field(xo.buildFieldWrites({ nativeShapes: true }), 'output.parameterized_shapes.flatten');
  assert.strictEqual(on.value, 'false');
  const off = field(xo.buildFieldWrites({ nativeShapes: false }), 'output.parameterized_shapes.flatten');
  assert.strictEqual(off.value, 'true');
});

check('every write targets a field the site exposes', () => {
  const w = xo.buildFieldWrites({});
  const expected = [
    'file_format', 'ui.svg_version_mode', 'svg.fixed_size',
    'draw_style', 'shape_stacking', 'group_by', 'gap_filler.enabled',
    'output.parameterized_shapes.flatten', 'curves.allowed.cubic_bezier',
    'curves.allowed.quadratic_bezier', 'curves.allowed.circular_arc',
    'curves.allowed.elliptical_arc', 'curves.line_fit_tolerance',
    'output.strokes.non_scaling_stroke', 'strokes.stroke_width', 'gap_filler.non_scaling_stroke'
  ];
  for (const name of expected) {
    assert.ok(field(w, name), 'missing write for ' + name);
  }
  assert.strictEqual(field(w, 'file_format').value, 'svg');
});

check('line fit maps fine/medium/coarse to tolerances', () => {
  assert.strictEqual(field(xo.buildFieldWrites({ lineFit: 'fine' }), 'curves.line_fit_tolerance').value, '0.03');
  assert.strictEqual(field(xo.buildFieldWrites({ lineFit: 'medium' }), 'curves.line_fit_tolerance').value, '0.1');
  assert.strictEqual(field(xo.buildFieldWrites({ lineFit: 'coarse' }), 'curves.line_fit_tolerance').value, '0.3');
  /* the page's radio group only accepts these four */
  const allowed = ['0.3', '0.1', '0.03', '0.01'];
  for (const v of ['fine', 'medium', 'coarse']) {
    assert.ok(allowed.indexOf(field(xo.buildFieldWrites({ lineFit: v }), 'curves.line_fit_tolerance').value) >= 0, 'bad tolerance for ' + v);
  }
});

check('the options file is read from the bridge folder next to the profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-vx-'));
  const profile = path.join(dir, 'vectorizer-profile');
  fs.mkdirSync(profile, { recursive: true });
  const file = path.join(dir, 'export-options.json');
  fs.writeFileSync(file, JSON.stringify({ preset: 'cutting' }), 'utf8');
  assert.strictEqual(xo.optionsPath({ profile }), file);
  const loaded = xo.loadOptionsFile({ profile });
  assert.strictEqual(loaded.preset, 'cutting');
  assert.strictEqual(loaded.draw, 'stroke_edges');
  assert.strictEqual(xo.loadOptionsFile({ profile: path.join(dir, 'nested', 'vectorizer-profile') }), null);
});

check('a broken options file is ignored, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-vx2-'));
  fs.writeFileSync(path.join(dir, 'export-options.json'), '{not json', 'utf8');
  assert.strictEqual(xo.loadOptionsFile({ exportOptions: path.join(dir, 'export-options.json') }), null);
});

console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll export-option checks passed');
process.exit(failures ? 1 : 0);

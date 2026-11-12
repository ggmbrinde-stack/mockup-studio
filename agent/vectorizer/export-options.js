/* vectorizer.ai export settings, applied inside the site's own Download page.

   That page is a plain form whose fields are named after the API parameters
   (file_format, draw_style, shape_stacking, group_by, gap_filler.enabled,
   curves.*, svg.version, svg.adobe_compatibility_mode, strokes.*), so the panel's
   choices can be written straight into those fields before Download is clicked.
   Matching is by field NAME, never by visible text, so it keeps working in any
   site language and does not depend on the page's markup or CSS classes.

   No network of its own: it only edits the page the agent already has open. */

const fs = require('fs');
const path = require('path');

/* Defaults mirror the site's own "General purpose" preset, so an install that
   never opens Settings behaves exactly like the site did before this existed. */
const DEFAULTS = {
  preset: 'general',
  svgVersion: 'svg_1_1',
  adobe: false,
  fixedSize: false,
  draw: 'fill_shapes',
  stack: 'cutouts',
  group: 'none',
  nativeShapes: true,
  gapFiller: true,
  curves: 'all',
  lineFit: 'medium',
  strokeWidth: 1,
  strokeFixed: true
};

/* The site's three presets, read from its own bundle. "custom" is derived: any
   edit to the fields below simply stops matching a preset. */
const PRESETS = {
  general: { draw: 'fill_shapes', stack: 'cutouts', group: 'none', nativeShapes: true, gapFiller: true },
  editing: { draw: 'fill_shapes', stack: 'stacked', group: 'color', nativeShapes: true, gapFiller: false },
  cutting: { draw: 'stroke_edges', stack: 'cutouts', group: 'none', nativeShapes: true, gapFiller: false }
};

const ENUMS = {
  preset: ['general', 'editing', 'cutting', 'custom'],
  svgVersion: ['svg_1_1', 'svg_1_0', 'svg_tiny_1_2'],
  draw: ['fill_shapes', 'stroke_shapes', 'stroke_edges'],
  stack: ['cutouts', 'stacked'],
  group: ['none', 'color', 'parent', 'layer'],
  curves: ['all', 'cubic'],
  lineFit: ['fine', 'medium', 'coarse']
};

/* Max error allowed when curves are approximated with line segments. These are
   the four values the site's own radio group offers (0.01 is its finest). */
const LINE_FIT = { fine: '0.03', medium: '0.1', coarse: '0.3' };

function pickEnum(key, value, fallback) {
  const v = String(value == null ? '' : value);
  return ENUMS[key].indexOf(v) >= 0 ? v : fallback;
}

function normalize(raw) {
  const o = Object.assign({}, DEFAULTS);
  const src = raw && typeof raw === 'object' ? raw : {};
  o.preset = pickEnum('preset', src.preset, DEFAULTS.preset);
  /* A preset chosen in the panel also fills the fields it stands for, exactly
     like clicking it on the site would. */
  if (PRESETS[o.preset]) Object.assign(o, PRESETS[o.preset]);
  if (src.draw !== undefined) o.draw = pickEnum('draw', src.draw, o.draw);
  if (src.stack !== undefined) o.stack = pickEnum('stack', src.stack, o.stack);
  if (src.group !== undefined) o.group = pickEnum('group', src.group, o.group);
  if (src.nativeShapes !== undefined) o.nativeShapes = !!src.nativeShapes;
  if (src.gapFiller !== undefined) o.gapFiller = !!src.gapFiller;
  o.svgVersion = pickEnum('svgVersion', src.svgVersion, DEFAULTS.svgVersion);
  o.adobe = src.adobe === undefined ? DEFAULTS.adobe : !!src.adobe;
  o.fixedSize = src.fixedSize === undefined ? DEFAULTS.fixedSize : !!src.fixedSize;
  o.curves = pickEnum('curves', src.curves, DEFAULTS.curves);
  o.lineFit = pickEnum('lineFit', src.lineFit, DEFAULTS.lineFit);
  const sw = parseFloat(src.strokeWidth);
  o.strokeWidth = isFinite(sw) ? Math.max(0, Math.min(5, sw)) : DEFAULTS.strokeWidth;
  o.strokeFixed = src.strokeFixed === undefined ? DEFAULTS.strokeFixed : !!src.strokeFixed;
  /* Adobe compatibility only emits lines and cubic Béziers, so it implies the
     curve restriction the site applies when that switch is turned on. */
  if (o.adobe) o.curves = 'cubic';
  return o;
}

/* One entry per form field to write. `names` lists the field names to try, in
   order: a couple of them exist under two spellings across site builds. */
function buildFieldWrites(raw) {
  const o = normalize(raw);
  const writes = [];
  const add = (names, value, kind) => writes.push({ names: [].concat(names), value: String(value), kind: kind || 'value' });

  add('file_format', 'svg', 'pick');
  /* The page has one radio group for both jobs: svg_1_0 / svg_1_1 / svg_tiny_1_2
     and "adobe", which the site expands into svg_1_1 + Adobe compatibility. */
  add('ui.svg_version_mode', o.adobe ? 'adobe' : o.svgVersion, 'pick');
  add('svg.fixed_size', o.fixedSize, 'flag');

  add('draw_style', o.draw, 'pick');
  add('shape_stacking', o.stack, 'pick');
  add('group_by', o.group, 'pick');
  add('gap_filler.enabled', o.gapFiller, 'flag');

  /* "Native shapes" is the inverse of the site's flatten flag. */
  add(['output.parameterized_shapes.flatten', 'parameterized_shapes.flatten'], !o.nativeShapes, 'flag');

  const cubicOnly = o.curves === 'cubic';
  add('curves.allowed.cubic_bezier', true, 'flag');
  add('curves.allowed.quadratic_bezier', !cubicOnly, 'flag');
  add('curves.allowed.circular_arc', !cubicOnly, 'flag');
  add('curves.allowed.elliptical_arc', !cubicOnly, 'flag');
  add('curves.line_fit_tolerance', LINE_FIT[o.lineFit] || LINE_FIT.medium, 'pick');

  add(['output.strokes.non_scaling_stroke', 'strokes.non_scaling_stroke'], o.strokeFixed, 'flag');
  add('strokes.stroke_width', o.strokeWidth, 'value');
  add('gap_filler.non_scaling_stroke', o.strokeFixed, 'flag');
  return writes;
}

/* Written into the page: finds each field by name and puts it in the state the
   panel asked for. Radios and checkboxes are clicked so the site's own handlers
   run; text fields get input/change events. Returns what it changed and what it
   could not find, so a change on their side shows up in the log instead of
   silently producing a different file. */
function applyWritesInPage(list) {
  const out = { applied: [], missing: [], values: {} };
  const fire = (el, types) => {
    for (let i = 0; i < types.length; i++) {
      try { el.dispatchEvent(new Event(types[i], { bubbles: true })); } catch (e) { }
    }
  };
  const truthy = v => v === 'true' || v === '1';

  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    let els = [];
    let used = '';
    for (let n = 0; n < w.names.length; n++) {
      try {
        els = Array.prototype.slice.call(document.getElementsByName(w.names[n]));
      } catch (e) { els = []; }
      if (els.length) { used = w.names[n]; break; }
    }
    if (!els.length) { out.missing.push(w.names[0]); continue; }

    if (w.kind === 'pick') {
      const want = String(w.value).toLowerCase();
      const radio = els.filter(e => String(e.value).toLowerCase() === want)[0];
      if (radio) {
        if (!radio.checked) radio.click();
        else fire(radio, ['input', 'change']);
      } else {
        const single = els[0];
        if (single && String(single.tagName).toUpperCase() === 'SELECT') {
          single.value = w.value;
          fire(single, ['input', 'change']);
        } else {
          out.missing.push(used + '=' + w.value);
          continue;
        }
      }
    } else if (w.kind === 'flag') {
      const box = els.filter(e => e.type === 'checkbox')[0] || els[0];
      const want = truthy(w.value);
      if (!!box.checked !== want) box.click();
      else fire(box, ['input', 'change']);
    } else {
      const single = els[0];
      single.value = w.value;
      fire(single, ['input', 'change', 'blur']);
    }

    const chosen = els.filter(e => e.checked)[0] || els[0];
    out.applied.push(used);
    out.values[used] = w.kind === 'flag'
      ? String(!!(els.filter(e => e.type === 'checkbox')[0] || chosen).checked)
      : String(chosen.value);
  }
  return out;
}

async function applyExportOptions(page, raw) {
  const writes = buildFieldWrites(raw);
  /* Serialised so the function runs inside the page, not in Node. */
  /* page.evaluate() runs a string as an expression, so the helper is wrapped in
     an IIFE: a bare top-level `return` is a syntax error there. */
  const result = await page.evaluate(
    '(function () { var applyWritesInPage = ' + applyWritesInPage.toString() + ';' +
    ' return applyWritesInPage(' + JSON.stringify(writes) + '); })()'
  );
  return { writes: writes, applied: result.applied, missing: result.missing, values: result.values };
}

/* The panel writes its choices next to the Chrome profile, so the agent finds
   them without anything being passed through a command line. */
function optionsPath(opts) {
  /* run.js keeps CLI keys as written, so --export-options arrives as
     opts['export-options']; the daemon sends it as exportOptions. */
  const explicit = opts && (opts.exportOptions || opts['export-options']);
  if (explicit) return String(explicit);
  const profile = opts && opts.profile ? String(opts.profile) : '';
  if (!profile) return '';
  return path.join(path.dirname(profile), 'export-options.json');
}

function loadOptionsFile(opts) {
  const p = optionsPath(opts);
  if (!p) return null;
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

module.exports = {
  DEFAULTS,
  PRESETS,
  ENUMS,
  LINE_FIT,
  normalize,
  buildFieldWrites,
  applyExportOptions,
  optionsPath,
  loadOptionsFile
};

// sheet.js — read a spreadsheet into a table.
//
// An .xlsx is a ZIP of XML, and the browser can open both halves by itself: the zip's
// central directory is read by hand, each part is inflated with DecompressionStream, and
// the XML goes through DOMParser. A .csv is already a table. So there is nothing to
// install, nothing to build, and nothing fetched from anywhere but this machine.
//
// What it shows is what the file stores, read the way the file says to read it: every value
// through the number format beside it — the day a workbook keeps as 46090 is the 9th of
// March 2026 — the column widths, row heights, hidden rows and frozen panes its author set,
// and the font, fill and alignment of each cell. Rows with nothing in them above the writing
// and below it are left out — the row numbers say which rows are shown. A formula is shown as
// the result the file last wrote beside it, since the viewer does not evaluate one, and it
// draws no charts or images: neither is in the grid this reader has.
(function () {
  "use strict";

  // A sheet longer than this is shown cut, with a line saying so. A table has no scrolling
  // trick of its own — every row of it is a row of the page — so the cap is what keeps a
  // 200,000-row export from taking the browser down with it. Both a row count and a cell
  // count, because 5,000 rows of 300 columns is the same amount of work as 75,000 rows of
  // 20. The reader's own largest sheet is 1,000 × 21, which fits with room to spare.
  const MAX_ROWS = 10000;
  const MAX_CELLS = 50000;

  /* ------------------------------------------------------------------- zip -- */

  // The end-of-central-directory record, found from the back. Its signature is the one
  // thing a workbook cannot fake, and the comment a zip may carry after it is why the
  // scan walks backwards instead of sitting at a fixed offset from the end.
  function findEocd(bytes) {
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  const decoder = new TextDecoder();

  function inflate(view) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("this browser cannot open a zip (no DecompressionStream)");
    }
    const stream = new Blob([view]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then((buf) => new Uint8Array(buf));
  }

  // The zip, read once and kept compressed. A workbook is opened a sheet at a time, and
  // inflating all 101 parts of the 600 KB file to show one of its 22 sheets is work
  // nobody asked for. Each part is located by its local header rather than by the sizes
  // in the central directory, because the streamed entries Excel writes for a large
  // sheet leave those sizes zero while the local header is always filled in.
  async function openZip(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("the reader could not read the file (HTTP " + response.status + ")");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error("this is not a zip, so it is not an .xlsx — a renamed file has to be a real one");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const parts = new Map();
    for (let i = 0; i < count; i++) {
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const local = view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      // a local header repeats the name and extra field, at lengths of its own
      const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      parts.set(name, { method: method, size: size, at: dataAt });
      at += 46 + nameLen + extraLen + commentLen;
    }
    return {
      names: Array.from(parts.keys()),
      async read(name) {
        const part = parts.get(name);
        if (!part) return null;
        const raw = bytes.subarray(part.at, part.at + part.size);
        return part.method === 0 ? raw : inflate(raw);
      },
    };
  }

  /* ------------------------------------------------------------------- xml -- */

  function parse(bytes) {
    const parsed = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
    if (parsed.getElementsByTagName("parsererror").length) {
      throw new Error("a part of the workbook is not XML the browser can read");
    }
    return parsed;
  }

  // `getElementsByTagName` matches on the local name, which is what the spreadsheet
  // schema means and what a workbook written by a tool other than Excel still satisfies.
  function all(node, name) {
    return Array.from(node.getElementsByTagName(name));
  }

  function textOf(node) {
    return (node && node.textContent) || "";
  }

  // A shared string is a list of runs, and a run may be split mid-word by formatting
  // nobody reading the cell wants to see. `rPh` is a phonetic guide — the reading above
  // the kanji — and it is a child of `si` but not a run, so it is skipped by looking at
  // the children rather than at every `t` underneath.
  function stringItem(item) {
    let out = "";
    for (const child of item.children) {
      if (child.nodeName === "t") out += textOf(child);
      else if (child.nodeName === "r") out += textOf(child.getElementsByTagName("t")[0]);
    }
    return out;
  }

  /* ----------------------------------------------------------------- cells -- */

  // "BC12" -> column 54 (zero-based) and row 12 (the file's own 1-based numbering).
  function splitRef(ref) {
    const found = /^([A-Z]+)(\d+)$/.exec(ref || "");
    if (!found) return null;
    let col = 0;
    for (const ch of found[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, row: Number(found[2]) };
  }

  function colName(index) {
    let name = "";
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  // The stored value of a cell. `t` says how to read it: a shared string is an index into
  // sharedStrings.xml, an inline string is its own text, a boolean is 1 or 0, and an
  // error is the value Excel wrote — everything else, `n` and `str` alike, is the text of
  // `<v>` as it stands. A date is one of those numbers: the file counts days from 1900,
  // and what turns the count back into a date is the cell's number format, which the caller
  // applies once the styles that carry it have been read.
  //
  // The result carries whether the cell was a number, because that is what decides how
  // it is set: a spreadsheet puts its numbers against the right edge so the digits line
  // up in a column, and reading a column of quantities is the whole reason to open one.
  function cellValue(cell, shared) {
    const type = cell.getAttribute("t");
    if (type === "s") {
      const value = shared[Number(textOf(cell.getElementsByTagName("v")[0]))];
      return { text: value === undefined ? "" : value, num: false };
    }
    if (type === "inlineStr") {
      const inline = cell.getElementsByTagName("is")[0];
      return { text: inline ? stringItem(inline) : "", num: false };
    }
    const value = textOf(cell.getElementsByTagName("v")[0]);
    if (type === "b") return { text: value === "1" ? "TRUE" : "FALSE", num: false };
    if (type === "str" || type === "e") return { text: value, num: false };
    return { text: value, num: true };
  }

  // One worksheet, as rows. A worksheet is sparse — row 12 may be the first one with
  // anything in it, and `C5` may be the only cell in its row — so the reference is what
  // places a cell and the gap before it is simply empty.
  function readSheet(bytes, shared, styles, date1904) {
    const parsed = parse(bytes);
    const rows = [];
    const heights = [];
    const hiddenRows = new Set();
    let width = 0;
    for (const row of all(parsed, "row")) {
      const at = Number(row.getAttribute("r") || rows.length + 1) - 1;
      // A row's height is written in points, and it is a floor rather than a box: a row the
      // file made 19 points tall still has to show the four lines a wrapped sentence needs,
      // because a reader that clipped the file's own text would be hiding it.
      const tall = row.getAttribute("ht");
      if (tall !== null && row.getAttribute("customHeight") !== "0") {
        heights[at] = Number(tall) * (96 / 72);
      }
      if (row.getAttribute("hidden") === "1" || row.getAttribute("hidden") === "true") {
        hiddenRows.add(at);
      }
      const line = [];
      let next = 0;
      for (const cell of all(row, "c")) {
        const ref = splitRef(cell.getAttribute("r"));
        const col = ref ? ref.col : next;
        const value = cellValue(cell, shared);
        // What a cell reads as is the file's own answer rather than the viewer's, and it is
        // worked out here rather than where the cell is drawn: the page and a test then see
        // the same string, and neither of them has to know what a `numFmtId` is.
        const style = styles.xfs[Number(cell.getAttribute("s"))] || null;
        if (style) {
          if (style.code) value.text = formatValue(value.text, style.code, date1904, value.num);
          value.style = style;
        }
        line[col] = value;
        next = col + 1;
        if (col + 1 > width) width = col + 1;
      }
      rows[at] = line;
    }
    // A merged range keeps its value in the top-left cell and leaves the rest empty, so
    // without this an inventory's merged header reads as one word followed by blanks.
    const merges = all(parsed, "mergeCell")
      .map((merge) => merge.getAttribute("ref"))
      .filter(Boolean);
    // A sheet can turn the gridlines off, and then its own borders are the whole of the
    // grid. The view draws a line around every cell either way — a table of numbers without
    // one is a paragraph of numbers — so what the file said is read and passed on, not
    // obeyed to the letter.
    const view = all(parsed, "sheetView")[0];
    return {
      rows: rows,
      width: width,
      merges: merges,
      heights: heights,
      hiddenRows: hiddenRows,
      cols: readColumns(parsed),
      frozen: readPane(parsed),
      gridlines: !view || view.getAttribute("showGridLines") !== "0",
    };
  }

  function mergeMaps(merges) {
    const span = new Map();
    const covered = new Set();
    for (const ref of merges) {
      const [from, to] = ref.split(":");
      const start = splitRef(from);
      const end = splitRef(to || from);
      if (!start || !end) continue;
      span.set(start.row + "," + start.col, { rows: end.row - start.row + 1, cols: end.col - start.col + 1 });
      for (let r = start.row; r <= end.row; r++) {
        for (let c = start.col; c <= end.col; c++) {
          if (r !== start.row || c !== start.col) covered.add(r + "," + c);
        }
      }
    }
    return { span: span, covered: covered };
  }

  /* ------------------------------------------------------------------ csv -- */

  // A delimited file where a field may be quoted and hold the separator, a newline, or a
  // doubled quote for a literal one. Splitting on commas gets all three wrong, and the
  // separator is the file's own — a .tsv is the same file with tabs and a different name.
  function parseDelimited(text, separator) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') { field += ch; continue; }
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      if (ch === '"' && field === "") { quoted = true; continue; }
      if (ch === separator) { row.push(field); field = ""; continue; }
      // a byte-order mark is not part of the first field, and neither \r\n nor a bare \r
      // ends a row without the field that follows it
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        continue;
      }
      if (ch === "\ufeff" && !row.length && !field) continue;
      field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // a delimited file says nothing about what its fields are, so every one of them is
    // text: the viewer will not align a column of digits on a guess the file never made
    for (const line of rows) {
      for (let c = 0; c < line.length; c++) line[c] = { text: line[c], num: false };
    }
    let width = 0;
    for (const line of rows) if (line.length > width) width = line.length;
    return { rows: rows, width: width, merges: [] };
  }

  /* ------------------------------------------------------- the file's own look -- */

  // A workbook is not only its values. The width of every column, the height of every row,
  // the fonts, the fills and the number formats are written down in the file as well, and a
  // viewer that ignores them shows a table that never existed: the author's header band and
  // totals row flattened into the same grey as everything else. This section reads that
  // half of the file. Nothing here is guessed from the values.

  // The palette from before colours had names: sixty-four slots, reached by index. It is
  // the file format's palette and not any one program's, so a workbook written decades ago
  // still means these by the numbers in it.
  const INDEXED = ("000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF," +
    "000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF," +
    "800000,008000,000080,808000,800080,008080,C0C0C0,808080," +
    "9999FF,993366,FFFFCC,CCFFFF,660066,FF8080,0066CC,CCCCFF," +
    "000080,FF00FF,FFFF00,00FFFF,800080,800000,008080,0000FF," +
    "00CCFF,CCFFFF,CCFFCC,FFFF99,99CCFF,FF99CC,CC99FF,FFCC99," +
    "3366FF,33CCCC,99CC00,FFCC00,FF9900,FF6600,666699,969696," +
    "003366,339966,003300,333300,993300,993366,333399,333333").split(",");

  function hexOf(value) {
    return typeof value === "string" && value.length >= 6
      ? "#" + value.slice(-6).toLowerCase()
      : null;
  }

  // theme1.xml is the workbook's own colour scheme, and a style that says `theme="4"` means
  // the fourth slot of it rather than any colour of its own. The slot names below are in
  // the order the schema means by the numbers, which is not the order they appear in.
  const THEME_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
    "accent4", "accent5", "accent6", "hlink", "folHlink"];

  function readTheme(bytes) {
    if (!bytes) return [];
    const scheme = all(parse(bytes), "clrScheme")[0];
    if (!scheme) return [];
    return THEME_SLOTS.map((slot) => {
      const found = all(scheme, slot)[0];
      const named = found && found.getElementsByTagName("srgbClr")[0];
      const system = found && found.getElementsByTagName("sysClr")[0];
      // a scheme written for one window system names a system colour and writes down the
      // value it had there: that value is what a file has to be read with
      return named ? hexOf(named.getAttribute("val"))
        : system ? hexOf(system.getAttribute("lastClr")) : null;
    });
  }

  function hsl(hex) {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(rgb[0], rgb[1], rgb[2]);
    const min = Math.min(rgb[0], rgb[1], rgb[2]);
    const light = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: light };
    const span = max - min;
    const sat = light > 0.5 ? span / (2 - max - min) : span / (max + min);
    const which = max === rgb[0] ? (rgb[1] - rgb[2]) / span + (rgb[1] < rgb[2] ? 6 : 0)
      : max === rgb[1] ? (rgb[2] - rgb[0]) / span + 2
      : (rgb[0] - rgb[1]) / span + 4;
    return { h: which / 6, s: sat, l: light };
  }

  function rgbOf(h, s, l) {
    const at = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * value).toString(16).padStart(2, "0");
    };
    return "#" + at(0) + at(8) + at(4);
  }

  // `tint` moves a colour towards white or towards black along its own lightness. That is
  // the rule the file format states, and it is why a tinted theme colour is not a blend of
  // two hex numbers: the hue and the strength of the colour stay, only the light moves.
  function tinted(hex, tint) {
    if (!hex || !tint) return hex;
    const colour = hsl(hex);
    const light = tint < 0 ? colour.l * (1 + tint)
      : colour.l * (1 - tint) + 1 - (1 - colour.l) * (1 - tint);
    return rgbOf(colour.h, colour.s, Math.max(0, Math.min(1, light)));
  }

  // A colour in a workbook is one of four things and only one of them is a colour. `auto`
  // is not: it means the scheme's own text colour, and what colour text is on the page is
  // the reader's decision, made once in the stylesheet, not the file's.
  function resolveColor(node, theme) {
    if (!node) return null;
    const rgb = node.getAttribute("rgb");
    if (rgb) return /^0{6,8}$/.test(rgb) ? null : hexOf(rgb);
    const indexed = node.getAttribute("indexed");
    if (indexed !== null) {
      const slot = Number(indexed);
      if (slot === 64 || slot === 65) return null;
      return "#" + (INDEXED[slot] || "000000").toLowerCase();
    }
    const slot = node.getAttribute("theme");
    if (slot !== null) return tinted(theme[Number(slot)] || null, Number(node.getAttribute("tint") || 0));
    return null;
  }

  // styles.xml is a table of tables — fonts by index, fills by index, number formats by id —
  // and then one `xf` per index that a cell can point at with `s=`. That last table is what
  // a cell means; everything else is reached from it, and nothing is reached that the cell
  // did not ask for.
  function readStyles(bytes, theme) {
    if (!bytes) return { xfs: [] };
    const parsed = parse(bytes);
    const formats = new Map();
    for (const fmt of all(parsed, "numFmt")) {
      formats.set(Number(fmt.getAttribute("numFmtId")), fmt.getAttribute("formatCode") || "General");
    }
    const fonts = all(parsed, "font").map((font) => {
      const flag = (name) => {
        const found = all(font, name)[0];
        if (!found) return false;
        const off = found.getAttribute("val");
        return off !== "0" && off !== "false";
      };
      return {
        bold: flag("b"),
        italic: flag("i"),
        underline: flag("u"),
        strike: flag("strike"),
        color: resolveColor(all(font, "color")[0], theme),
      };
    });
    const fills = all(parsed, "fill").map((fill) => {
      const pattern = all(fill, "patternFill")[0];
      if (!pattern) return null;
      const kind = pattern.getAttribute("patternType") || "none";
      // the file saying "no fill" is not a colour, and it is what most of the fills in a
      // workbook are: an unused slot in the table
      if (kind === "none") return null;
      // `fgColor` is the colour and `bgColor` the ground beneath it, which is the reverse
      // of what the two words suggest: a solid fill is written as an `fgColor` and nothing
      // else. Any other pattern is read as its colour too — the stripes and grids a file
      // can ask for are a texture this view does not draw.
      return resolveColor(all(pattern, "fgColor")[0], theme) ||
        resolveColor(all(pattern, "bgColor")[0], theme);
    });
    const group = all(parsed, "cellXfs")[0];
    const xfs = group ? Array.from(group.children).filter((node) => node.nodeName === "xf") : [];
    return {
      xfs: xfs.map((xf) => {
        const id = Number(xf.getAttribute("numFmtId") || 0);
        const alignment = all(xf, "alignment")[0];
        // `applyFont` and its neighbours say whether the style is allowed to use what it
        // names. A style made by changing one thing and leaving the rest leaves them off,
        // and painting a cell with the font the style does not apply is how a header band
        // ends up repeated down the page.
        const applies = (name) => {
          const value = xf.getAttribute("apply" + name);
          return value === null || (value !== "0" && value !== "false");
        };
        return {
          code: formats.get(id) || BUILTIN_CODES[id] || null,
          font: applies("Font") ? fonts[Number(xf.getAttribute("fontId") || 0)] || null : null,
          fill: applies("Fill") ? fills[Number(xf.getAttribute("fillId") || 0)] || null : null,
          halign: alignment ? alignment.getAttribute("horizontal") : null,
          valign: alignment ? alignment.getAttribute("vertical") : null,
          indent: alignment ? Math.max(0, Number(alignment.getAttribute("indent") || 0)) : 0,
        };
      }),
    };
  }

  // A file's colours belong to the file, but the page they land on has a scheme of its own,
  // and a white header band is a hole in a dark one. So a colour is read into the theme
  // rather than dropped: the hue and something of the strength are the file's, and only the
  // lightness turns around. A red header stays red; a pale blue band stays pale. On a light
  // page nothing turns — the file's own colours are what the author saw.
  function inTheme(hex, dark, kind) {
    if (!hex || !dark) return hex;
    const colour = hsl(hex);
    if (kind === "fill") {
      // a fill has to stay darker than the text on it, so it is mapped into the dark end of
      // the range whatever lightness it came with
      return rgbOf(colour.h, colour.s * 0.7, 0.1 + Math.min(0.22, (1 - colour.l) * 0.24));
    }
    return rgbOf(colour.h, colour.s, Math.max(0.62, Math.min(0.95, 1 - colour.l)));
  }

  function themed() {
    return document.documentElement.getAttribute("data-mdview-theme") === "dark";
  }

  // The columns of a sheet: how wide the file says each of them is, in characters of the
  // workbook's own default font, and whether it is hidden. Only the columns with something
  // to say appear in the file, so what comes back is a lookup rather than a list — and a
  // column nobody mentions was never given a width to be honoured.
  function readColumns(parsed) {
    const width = new Map();
    const hidden = new Set();
    for (const col of all(parsed, "col")) {
      const from = Number(col.getAttribute("min") || 1);
      const to = Number(col.getAttribute("max") || from);
      const said = col.getAttribute("width");
      const custom = said !== null && col.getAttribute("customWidth") !== "0";
      const off = col.getAttribute("hidden") === "1" || col.getAttribute("hidden") === "true";
      for (let c = from - 1; c < to && c < 16384; c++) {
        if (custom) width.set(c, Number(said));
        if (off) hidden.add(c);
      }
    }
    return { width: width, hidden: hidden };
  }

  // A frozen pane is the author saying which rows and columns stay put while the rest
  // moves — the file's own answer to a wide table, rather than one this viewer invents.
  // A split (as opposed to a frozen) pane is a scroll position, not a rule about the sheet.
  function readPane(parsed) {
    const pane = all(parsed, "pane")[0];
    if (!pane || (pane.getAttribute("state") || "frozen") !== "frozen") return { cols: 0, rows: 0 };
    return {
      cols: Math.max(0, Math.floor(Number(pane.getAttribute("xSplit") || 0))),
      rows: Math.max(0, Math.floor(Number(pane.getAttribute("ySplit") || 0))),
    };
  }

  // A column width is written in characters of the workbook's default font, which is not a
  // length until it is multiplied by the width of one. `max digit width` is what the format
  // calls that number, and every program that writes a workbook computes it from the font
  // it was going to draw with; this viewer draws with the reader's font, so it measures its
  // own — the first cell on the page is the ruler, and a `0` on it is the unit.
  function charWidth() {
    const probe = document.createElement("span");
    probe.textContent = "0000000000";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
    const host = document.getElementById("sheet");
    if (!host) return 7;
    host.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width > 0 ? width / 10 : 7;
  }

  // How wide a column written as `width` characters comes out on this page. The five pixels
  // are the format's own: every column carries a little padding beside its characters, and
  // a column written as three characters is not three characters of room but three and the
  // space a cell needs around them.
  function columnPx(chars, unit) {
    return Math.round(chars * unit + 5);
  }

  /* -------------------------------------------------------------- formats -- */

  // What a value reads as is not what the file stores. A date is a number of days, a price
  // is a number of cents' worth of digits, a percentage is a fraction — and the style of the
  // cell carries the small language that says how to show it. Everything in this section is
  // that language: nothing here looks at the values, only at the code beside them.

  // The built-in formats, by the id a style points at instead of writing the code out. The
  // ids are the file format's own, and a workbook from any program means the same by them.
  const BUILTIN_CODES = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
    5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)',
    7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
    14: "m/d/yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
    37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00 ;(#,##0.00)",
    40: "#,##0.00 ;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0",
    48: "##0.0E+0", 49: "@",
  };

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_MS = 86400000;

  // A code is sections separated by semicolons — what a positive number reads as, then a
  // negative one, then zero, then text. The split has to know that a semicolon inside a
  // quoted run or a bracket is part of that run, or a currency in brackets becomes two
  // sections and the value reads off the wrong one.
  function splitSections(code) {
    const out = [];
    let current = "";
    let quoted = false;
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (quoted) {
        current += ch;
        if (ch === '"') quoted = false;
        continue;
      }
      if (ch === "\\") { current += ch + (code[i + 1] || ""); i++; continue; }
      if (ch === '"') { quoted = true; current += ch; continue; }
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      else if (ch === ";" && depth === 0) { out.push(current); current = ""; continue; }
      current += ch;
    }
    out.push(current);
    return out;
  }

  // A bracket says something about the value rather than something the value shows: a
  // colour, a locale, the currency the symbol belongs to. The one exception is elapsed
  // time — `[h]` is a placeholder — and the currency symbol is written down because it is
  // the only place a file records which symbol to put in front of the number.
  function bracket(inside) {
    if (/^[hms]+$/i.test(inside)) return { elapsed: inside };
    if (inside.charAt(0) === "$") return { text: inside.slice(1).split("-")[0] };
    return {};
  }

  // The code with everything that is a note to the program taken out, leaving the
  // placeholders that say how the value is shaped. What is left says which kind of code it
  // is: a `y`, an `m`, an `h` or an `s` in it and it is a date, whatever else it holds.
  function stripped(code) {
    let out = "";
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') { const end = code.indexOf('"', i + 1); i = end < 0 ? code.length : end; continue; }
      if (ch === "\\" || ch === "_" || ch === "*") { i++; continue; }
      if (ch === "[") {
        const end = code.indexOf("]", i);
        const found = bracket(code.slice(i + 1, end < 0 ? code.length : end));
        if (found.text) out += found.text;
        else if (found.elapsed) out += "[" + found.elapsed + "]";
        i = end < 0 ? code.length : end;
        continue;
      }
      out += ch;
    }
    return out;
  }

  // The words and symbols around the number, with the placeholders left out: `"$"#,##0.00`
  // is a dollar sign and nothing else, and `#,##0" €"` is a space and a euro.
  function literals(code, text) {
    let out = "";
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') { const end = code.indexOf('"', i + 1); out += code.slice(i + 1, end < 0 ? code.length : end); i = end < 0 ? code.length : end; continue; }
      if (ch === "\\") { out += code[i + 1] || ""; i++; continue; }
      if (ch === "_" || ch === "*") { i++; continue; }
      if (ch === "@" && text !== undefined) { out += text; continue; }
      if (ch === "[") {
        const end = code.indexOf("]", i);
        const found = bracket(code.slice(i + 1, end < 0 ? code.length : end));
        out += found.text || "";
        i = end < 0 ? code.length : end;
        continue;
      }
      if (/[0#?,.]/.test(ch)) continue;
      out += ch;
    }
    return out;
  }

  // The words and symbols on each side of the digits. `literals` gives all of them as one
  // string, and the shape cannot say where the split falls: it has had the literals taken
  // out of it, so an index into it is not an index into the code. Reading the split off
  // one that way put the `"$"` of `"$"\ #,##0\ "M"` nowhere at all — the shape starts with
  // a placeholder — and left the space before the `M` behind, so a cell the file declares
  // as currency read as a bare number. So the code is walked once and each literal goes to
  // the side the placeholders have reached.
  function sides(code) {
    let head = "";
    let tail = "";
    let seen = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') {
        const end = code.indexOf('"', i + 1);
        const text = code.slice(i + 1, end < 0 ? code.length : end);
        if (seen) tail += text; else head += text;
        i = end < 0 ? code.length : end;
        continue;
      }
      if (ch === "\\") {
        const text = code[i + 1] || "";
        if (seen) tail += text; else head += text;
        i++;
        continue;
      }
      if (ch === "_" || ch === "*") { i++; continue; }
      if (ch === "[") {
        const end = code.indexOf("]", i);
        const found = bracket(code.slice(i + 1, end < 0 ? code.length : end));
        const text = found.text || "";
        if (seen) tail += text; else head += text;
        i = end < 0 ? code.length : end;
        continue;
      }
      // the placeholders are the digits; everything else is printed as it stands
      if (/[0#?]/.test(ch)) { seen = true; continue; }
      if (/[,.]/.test(ch)) continue;
      if (seen) tail += ch; else head += ch;
    }
    return { head: head, tail: tail };
  }

  function group(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // A number in the shape the code draws: how many digits stand after the point, whether
  // the thousands are separated, whether it is a percentage, and what is written around it.
  function formatNumber(value, code, negativeOwn) {
    const shape = stripped(code);
    // a fraction is a shape of its own and not this one: the digits after it are the
    // denominator rather than decimal places, and drawing it wrong is worse than not
    const point = shape.indexOf(".");
    // the whole part with its separators still in it, which is what says whether the file
    // wants the thousands grouped at all
    const whole = point < 0 ? shape : shape.slice(0, point);
    const before = whole.replace(/[^0#?]/g, "");
    const after = point < 0 ? "" : shape.slice(point + 1).replace(/[^0#?]/g, "");
    if (/\d\s*\/\s*[#0?]|[#0?]\s*\/\s*[#0?]/.test(shape)) return null;
    const percent = shape.indexOf("%") >= 0;
    const shown = percent ? Math.abs(value) * 100 : Math.abs(value);
    const around = sides(code);
    let digits;
    if (/[Ee][+-]/.test(shape)) {
      const places = after.length;
      digits = shown.toExponential(Math.min(places, 100)).replace("e", "E").replace(/E([+-])(\d)$/, "E$1$2");
    } else {
      digits = shown.toFixed(Math.min(after.length, 20));
      // thousands: a comma between the placeholders of the whole part, which is the only
      // comma in the code that separates anything
      if (whole.indexOf(",") >= 0) {
        const parts = digits.split(".");
        parts[0] = group(parts[0]);
        digits = parts.join(".");
      }
    }
    // `#` drops a trailing zero and `0` keeps it: 2 reads as 2 next to `#.##` and as 2.00
    // next to `0.00`, which is the difference between a measurement and a price
    if (after && digits.indexOf(".") >= 0) {
      const keep = after.replace(/[^0]/g, "").length || 0;
      const parts = digits.split(".");
      let frac = parts[1].replace(/0+$/, "");
      while (frac.length < keep) frac += "0";
      digits = frac ? parts[0] + "." + frac : parts[0];
    }
    const lead = around.head;
    const end = around.tail;
    return (negativeOwn && value < 0 ? "-" : "") + lead + digits + end;
  }

  // The day a serial number counts to. The file format's day zero is not quite a date: it
  // counts 1900 as a leap year because the program it was copied from did, so 60 is a
  // February 29th that never happened and every serial below it is a day out of step with
  // the arithmetic. Both are handled here rather than silently, since a date shown a day
  // early is a date a reader will believe.
  function serialParts(serial, date1904) {
    const whole = Math.floor(serial);
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const days = date1904 ? whole : whole < 60 ? whole + 1 : whole;
    const at = new Date(epoch + days * DAY_MS);
    const parts = {
      year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(),
      weekday: at.getUTCDay(),
    };
    if (!date1904 && whole === 60) { parts.month = 2; parts.day = 29; }
    let seconds = Math.round((serial - whole) * 86400);
    if (seconds >= 86400) { seconds -= 86400; parts.day += 1; }
    parts.hour = Math.floor(seconds / 3600);
    parts.minute = Math.floor(seconds / 60) % 60;
    parts.second = seconds % 60;
    parts.hours = Math.floor(serial * 24);
    parts.minutes = Math.floor(serial * 1440);
    parts.secs = Math.floor(serial * 86400);
    return parts;
  }

  function pad(number, width) {
    return String(number).padStart(width, "0");
  }

  // The date in the shape the code draws, month by month of it: a run of the same letter is
  // one placeholder, and how long the run is decides how much of the part is shown. English
  // names throughout — the file may have been written for another language, and the reader
  // has one.
  function formatDate(serial, code, date1904) {
    const parts = serialParts(serial, date1904);
    const twelve = /am\/pm|a\/p/i.test(code);
    let out = "";
    let i = 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === '"') { const end = code.indexOf('"', i + 1); out += code.slice(i + 1, end < 0 ? code.length : end); i = end < 0 ? code.length : end + 1; continue; }
      if (ch === "\\") { out += code[i + 1] || ""; i += 2; continue; }
      if (ch === "_" || ch === "*") { i += 2; continue; }
      if (/^AM\/PM/i.test(code.slice(i))) { out += parts.hour < 12 ? "AM" : "PM"; i += 5; continue; }
      if (/^A\/P/i.test(code.slice(i))) { out += parts.hour < 12 ? "A" : "P"; i += 3; continue; }
      if (ch === "[") {
        const end = code.indexOf("]", i);
        const found = bracket(code.slice(i + 1, end < 0 ? code.length : end));
        if (found.elapsed) {
          const total = found.elapsed.length > 1 ? { h: parts.hours, m: parts.minutes, s: parts.secs }[found.elapsed[0].toLowerCase()] : null;
          out += total === null ? pad(parts.hour, 2) : pad(total, 2);
        }
        i = end < 0 ? code.length : end + 1;
        continue;
      }
      const run = /[ymdhs]/i.test(ch) ? code.slice(i).match(new RegExp(ch + "+", "i"))[0] : null;
      if (!run) { out += ch; i++; continue; }
      i += run.length;
      const letter = ch.toLowerCase();
      const length = run.length;
      // `m` is the month or the minute and the code alone says which: a code with an hour
      // or a second in it is telling the time, and everything else in it is a date
      const minutes = letter === "m" && /[hs]/i.test(code);
      if (letter === "y") out += length >= 3 ? String(parts.year) : pad(parts.year % 100, 2);
      else if (letter === "d") out += length >= 4 ? WEEKDAYS[parts.weekday] : length === 3 ? WEEKDAYS[parts.weekday].slice(0, 3) : pad(parts.day, length >= 2 ? 2 : 1);
      else if (letter === "m") {
        if (minutes) out += pad(parts.minute, length >= 2 ? 2 : 1);
        else if (length >= 4) out += MONTHS[parts.month - 1];
        else if (length === 3) out += MONTHS[parts.month - 1].slice(0, 3);
        else out += pad(parts.month, length >= 2 ? 2 : 1);
      } else if (letter === "h") {
        const hour = twelve ? (parts.hour % 12 === 0 ? 12 : parts.hour % 12) : parts.hour;
        out += pad(hour, length >= 2 ? 2 : 1);
      } else out += pad(parts.second, length >= 2 ? 2 : 1);
    }
    return out;
  }

  // What the cell reads as. `General` is the file saying it has no format of its own, and a
  // value with no format stays exactly as it is stored — which for a date is the serial
  // number the file counts, and the reason a workbook can look wrong in a viewer that
  // guesses. Nothing here is applied to a guess: a cell is formatted because the file said
  // so, and a cell with no style reads as its own value.
  function formatValue(text, code, date1904, isNumber) {
    if (text === "") return text;
    const stored = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text);
    const numeric = isNumber === undefined ? stored : !!isNumber && stored;
    // `General` is the file saying it has no shape of its own. A number then keeps the
    // digits the file stored, with the zeros that were only filling a width taken off the
    // end: a stored `2025.0` is the number 2025, which is what the program that wrote the
    // file shows, and a cell read as `2025.0` says something the file did not. Text is
    // left exactly as it is — a note that reads `1.50` is a note about 1.50.
    if (!code || code === "General") {
      if (!numeric) return text;
      return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    const sections = splitSections(code);
    if (!numeric) return sections.length > 3 ? literals(sections[3], text) : text;
    const value = Number(text);
    // which section a number reads from: positives, negatives, zero — and a file that
    // writes one section means it for all three
    const own = value < 0 && sections[1] === undefined;
    let body = value > 0 ? sections[0] : value < 0 ? sections[1] : sections[2];
    if (body === undefined || body === null || body === "") body = sections[0];
    if (body === undefined || body === null || body === "") return text;
    const shape = stripped(body);
    if (/[ymdhs]/i.test(shape)) return formatDate(Math.abs(value), body, date1904);
    const drawn = formatNumber(value, body, own);
    return drawn === null ? text : drawn;
  }

  /* ----------------------------------------------------------------- table -- */

  // Where the writing is: the first and the last row of a sheet with anything in them. A
  // workbook's stored range is usually larger than its writing — rows a program gave a fill
  // and no text, or the thousand empty rows it wrote to be tidy — and a grid that opens on
  // blank space and ends in a hundred blank rows opens on nothing. What is left out is only
  // ever empty: the row numbers are the file's own, so the first one shown says what is not.
  function contentRange(rows) {
    const filled = (line) => Boolean(line) && line.some((item) => item && item.text !== "");
    let first = 0;
    let last = rows.length - 1;
    while (first <= last && !filled(rows[first])) first++;
    while (last >= first && !filled(rows[last])) last--;
    return { first: first, last: last };
  }

  function cell(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }

  function renderTable(sheet, wantHead, range, content) {
    const { span, covered } = mergeMaps(sheet.merges || []);
    const rows = sheet.rows;
    const width = Math.max(sheet.width, 1);
    // the rows with writing in them, not the rows the file counted: what is drawn starts and
    // ends with the writing, and the cap is measured from there
    const total = range.last - range.first + 1;
    const shown = Math.min(total, MAX_ROWS, Math.floor(MAX_CELLS / width));
    const cols = sheet.cols || { width: new Map(), hidden: new Set() };
    const frozen = sheet.frozen || { cols: 0, rows: 0 };
    // A row the file froze stays under the letters while the rest of the sheet moves, and
    // the file's freeze stands even with the reader's header row switched off: the freeze is
    // the workbook's structure, and the header row is one way of reading it.
    //
    // The header row is the first row of the grid when that is the first row with writing in
    // it. A picture can start the grid above the text — the file anchored a logo over the top
    // of the sheet — and a row of nothing but pictures is not a header to pin: it would be an
    // opaque band over the top of them, and the head of a table cannot come after its first
    // rows anyway, since the head is drawn above them.
    const headed = wantHead && range.first === content.first && content.last >= content.first;
    const headRows = Math.max(headed ? 1 : 0, Math.min(frozen.rows, shown));
    // the width of a character of the reader's own font, which is the unit the file writes
    // its column widths in; a workbook that names no widths needs none measured
    const unit = cols.width.size ? charWidth() : 0;
    const dark = themed();
    const wide = (c) => (cols.width.has(c) ? columnPx(cols.width.get(c), unit) : 0);

    const table = document.createElement("table");
    table.className = "sheet";
    const head = document.createElement("thead");
    const body = document.createElement("tbody");

    // Where the file says how wide a column is, the column is that wide and no wider: it is
    // the floor as well as the ceiling, because a column three characters across is three
    // characters across even with nothing in it. Only where the longest word in a cell is
    // wider still does the column open — the alternative to a wider column is half a word.
    function fit(td, c) {
      const px = wide(c);
      if (px) {
        td.style.setProperty("--cap", px + "px");
        td.style.setProperty("--floor", px + "px");
      }
      return td;
    }

    // A column the file hides is shown rather than hidden, and it says so: a hidden column
    // is usually where the numbers that were taken out of the summary still live, and a
    // reader looking at a file has more use for them than the file's author had. A frozen
    // column is marked here and positioned later, once the page knows how wide the row
    // numbers came out.
    function mark(td, c) {
      if (cols.hidden.has(c)) td.classList.add("hid");
      if (c < frozen.cols) td.setAttribute("data-freeze", String(c));
      return td;
    }

    // the column letters, the one piece of a spreadsheet the file never writes down
    const letters = document.createElement("tr");
    letters.className = "sheet-letters";
    letters.appendChild(cell("th", ""));
    for (let c = 0; c < width; c++) {
      const th = mark(fit(cell("th", colName(c)), c), c);
      if (cols.hidden.has(c)) th.title = "this column is hidden in the file";
      letters.appendChild(th);
    }
    head.appendChild(letters);

    // What the file said about one cell's own look. It goes on the cell rather than into a
    // class of cells, because two cells sharing a style is the exception in a workbook: the
    // point of a style is that this header is this header.
    function dress(td, item) {
      const style = item && item.style;
      if (!style) return td;
      const font = style.font;
      if (font) {
        if (font.bold) td.style.fontWeight = "650";
        if (font.italic) td.style.fontStyle = "italic";
        const lines = [font.underline ? "underline" : "", font.strike ? "line-through" : ""].filter(Boolean);
        if (lines.length) td.style.textDecoration = lines.join(" ");
        const ink = inTheme(font.color, dark, "ink");
        if (ink) td.style.color = ink;
      }
      const fill = inTheme(style.fill, dark, "fill");
      if (fill) td.style.backgroundColor = fill;
      if (style.halign) {
        td.style.textAlign = {
          center: "center", centerContinuous: "center", justify: "justify",
          distributed: "justify", fill: "left", left: "left", right: "right",
        }[style.halign] || style.halign;
      }
      if (style.valign) {
        td.style.verticalAlign = {
          center: "middle", justify: "middle", distributed: "middle",
          top: "top", bottom: "bottom",
        }[style.valign] || style.valign;
      }
      // an indent is three characters of the writer's own font, and it moves where the text
      // starts rather than where it sits, which is what centring already does
      if (style.indent) td.style.paddingLeft = (0.6 + style.indent * 1.9) + "em";
      return td;
    }

    for (let r = range.first; r < range.first + shown; r++) {
      // a row the file skipped has no `<row>`; the number still counts it
      const line = rows[r] || [];
      const tr = document.createElement("tr");
      // which row of the file this is: the grid trims the empty ones at either end, and a
      // picture is anchored by the file's own row number, not by what is on screen
      tr.setAttribute("data-row", String(r));
      const tall = sheet.heights && sheet.heights[r];
      if (tall) tr.style.height = tall.toFixed(1) + "px";
      if (sheet.hiddenRows && sheet.hiddenRows.has(r)) tr.classList.add("hid");
      const number = cell("th", String(r + 1));
      if (sheet.hiddenRows && sheet.hiddenRows.has(r)) {
        number.classList.add("hid");
        number.title = "this row is hidden in the file";
      }
      tr.appendChild(number);
      for (let c = 0; c < width; c++) {
        const key = (r + 1) + "," + c;
        if (covered.has(key)) continue;
        const item = line[c];
        const td = cell(r < headRows ? "th" : "td", item ? item.text : "");
        if (item && item.num) td.className = "num";
        dress(td, item);
        fit(td, c);
        mark(td, c);
        const size = span.get(key);
        if (size) {
          if (size.cols > 1) td.colSpan = size.cols;
          if (size.rows > 1) td.rowSpan = size.rows;
        }
        tr.appendChild(td);
      }
      (r < headRows ? head : body).appendChild(tr);
    }

    table.appendChild(head);
    table.appendChild(body);
    return { table: table, shown: shown, total: total, first: range.first, last: range.last };
  }

  /* -------------------------------------------------------------- pinning -- */

  // The rows and columns a file froze are pinned to the edges of the grid, and where to pin
  // them is measured rather than worked out: the row-number column is as wide as the numbers
  // in it and a frozen row is as tall as the text in it, and neither is a number anything can
  // know before the page has been laid out once. A sticky offset moves nothing, so measuring
  // after the table is in the document and setting it there is enough.
  function pinFrozen(table, sheet) {
    const frozen = sheet.frozen || { cols: 0, rows: 0 };
    if (!frozen.cols && !frozen.rows) return;
    const letters = table.querySelector("thead tr.sheet-letters");
    if (!letters) return;
    if (frozen.cols) {
      // the letters row has exactly one cell per column, so it is the ruler the rest of the
      // grid is measured against
      let left = letters.firstElementChild.getBoundingClientRect().width;
      const count = Math.min(frozen.cols, letters.children.length - 1);
      for (let c = 0; c < count; c++) {
        for (const pinned of table.querySelectorAll('[data-freeze="' + c + '"]')) {
          pinned.style.position = "sticky";
          pinned.style.left = left + "px";
        }
        left += letters.children[c + 1].getBoundingClientRect().width;
      }
    }
    if (frozen.rows) {
      let top = letters.getBoundingClientRect().height;
      for (const row of table.querySelectorAll("thead tr:not(.sheet-letters)")) {
        for (const pinned of row.children) pinned.style.top = top + "px";
        top += row.getBoundingClientRect().height;
      }
    }
  }

  /* -------------------------------------------------------------- pictures -- */

  // Where each picture sits, measured on the grid that has just been drawn. The file anchors
  // a picture to a cell and an offset into it; the column widths came from the file and the
  // row heights from the text in them, so the edge of a cell is only known once the page has
  // laid the table out — which is why this runs after the table is in the document, like the
  // pinning does.
  function placePictures(scroll, table, pictures) {
    if (!pictures || !pictures.length) return;
    const letters = table.querySelector("thead tr.sheet-letters");
    if (!letters) return;
    // the corner above the row numbers, then one cell per column
    const columns = Array.from(letters.children);
    const rows = new Map();
    let lastRow = -1;
    for (const tr of table.querySelectorAll("tr[data-row]")) {
      const at = Number(tr.getAttribute("data-row"));
      rows.set(at, tr);
      if (at > lastRow) lastRow = at;
    }
    const grid = table.getBoundingClientRect();
    // the edge of a column, in the table's own coordinates; past the drawn columns it is the
    // right edge of the grid, which is as far as the file's own letters reach
    function edgeX(col, off) {
      const th = columns[col + 1];
      const last = columns[columns.length - 1];
      if (!th && !last) return 0;
      const box = (th || last).getBoundingClientRect();
      return (th ? box.left : box.right) - grid.left + off / EMU;
    }
    function edgeY(row, off) {
      const tr = rows.get(row);
      if (tr) return tr.getBoundingClientRect().top - grid.top + off / EMU;
      if (lastRow < 0) return 0;
      return rows.get(lastRow).getBoundingClientRect().bottom - grid.top + off / EMU;
    }
    const layer = document.createElement("div");
    layer.className = "sheet-pictures";
    // the layer covers the table, so the table's own coordinates are the picture's
    layer.style.left = table.offsetLeft + "px";
    layer.style.top = table.offsetTop + "px";
    layer.style.width = table.offsetWidth + "px";
    layer.style.height = table.offsetHeight + "px";
    for (const picture of pictures) {
      const image = document.createElement("img");
      image.src = picture.url;
      image.alt = picture.alt;
      image.draggable = false;
      const x = edgeX(picture.from.col, picture.from.colOff);
      const y = edgeY(picture.from.row, picture.from.rowOff);
      const wide = picture.to ? edgeX(picture.to.col, picture.to.colOff) - x : picture.cx / EMU;
      const tall = picture.to ? edgeY(picture.to.row, picture.to.rowOff) - y : picture.cy / EMU;
      // a picture the file gives no size is not drawn: the alternative is its bytes at their
      // own resolution, which is a picture the sheet never showed
      if (!(wide > 0) || !(tall > 0)) continue;
      image.style.left = x + "px";
      image.style.top = y + "px";
      image.style.width = wide + "px";
      image.style.height = tall + "px";
      layer.appendChild(image);
    }
    scroll.appendChild(layer);
  }

  /* -------------------------------------------------------------------- ui -- */

  function toolbar(sheets, active, wantHead, onPick, onHead) {
    const bar = document.createElement("div");
    bar.className = "sheet-bar";

    const tabs = document.createElement("div");
    tabs.className = "sheet-tabs";
    tabs.setAttribute("role", "tablist");
    if (sheets.length < 2) tabs.hidden = true;
    sheets.forEach((sheet, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sheet-tab" + (index === active ? " on" : "");
      tab.textContent = sheet.name;
      if (sheet.hidden) {
        tab.classList.add("hid-sheet");
        tab.title = "this sheet is hidden in the file";
        // the mark is a border, which a screen reader cannot see: the name says it too
        tab.setAttribute("aria-label", sheet.name + " (hidden in the file)");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", index === active ? "true" : "false");
      tab.addEventListener("click", () => onPick(index));
      tabs.appendChild(tab);
    });
    bar.appendChild(tabs);

    const tools = document.createElement("div");
    tools.className = "sheet-tools";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "sheet-toggle" + (wantHead ? " on" : "");
    head.textContent = "Header row";
    head.setAttribute("aria-pressed", wantHead ? "true" : "false");
    head.addEventListener("click", () => onHead(head));
    tools.appendChild(head);
    const status = document.createElement("span");
    status.className = "sheet-status";
    status.id = "sheet-status";
    tools.appendChild(status);
    bar.appendChild(tools);

    return bar;
  }

  function note(text, kind) {
    const p = document.createElement("p");
    p.className = "sheet-note" + (kind ? " " + kind : "");
    p.textContent = text;
    return p;
  }

  /* -------------------------------------------------------------- workbook -- */

  // The sheet list, in the order the workbook shows it. `workbook.xml` names each sheet
  // and gives it an id; the id means nothing outside the workbook, so the part that holds
  // the sheet is found through the relationship the id points at.
  async function workbookSheets(zip) {
    const bookBytes = await zip.read("xl/workbook.xml");
    if (!bookBytes) throw new Error("the workbook has no xl/workbook.xml, so it has no sheets");
    const relBytes = await zip.read("xl/_rels/workbook.xml.rels");
    const targets = new Map();
    if (relBytes) {
      for (const rel of all(parse(relBytes), "Relationship")) {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target") || "";
        // relative to xl/, and some writers lead with a slash
        targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
      }
    }
    const book = parse(bookBytes);
    const sheets = [];
    all(book, "sheet").forEach((sheet, index) => {
      const id = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let part = id ? targets.get(id) : null;
      // a workbook whose relationships are missing still has its sheets where it always
      // puts them, in order — better a guessed sheet than no sheet at all
      if (!part) part = "worksheets/sheet" + (index + 1) + ".xml";
      // A sheet the file hides is still part of the workbook, and it is shown — like a
      // hidden column is — with a mark that says it is not in the author's own view.
      const state = sheet.getAttribute("state");
      sheets.push({
        name: sheet.getAttribute("name") || "Sheet" + (index + 1),
        part: "xl/" + part,
        hidden: state === "hidden" || state === "veryHidden",
      });
    });
    // A workbook written where 1904 counted as the beginning of time counts its days from
    // that year instead, and says so in one attribute: four years and a day lie between the
    // two, and no cell in the file says which of them it means.
    const settings = all(book, "workbookPr")[0];
    const epoch = settings && (settings.getAttribute("date1904") === "1" ||
      settings.getAttribute("date1904") === "true");
    return { sheets: sheets, date1904: !!epoch };
  }

  async function sharedStrings(zip) {
    const bytes = await zip.read("xl/sharedStrings.xml");
    if (!bytes) return [];
    return all(parse(bytes), "si").map(stringItem);
  }

  /* -------------------------------------------------------------- drawings -- */

  // A picture lives outside the sheet that shows it: the worksheet names a drawing part, the
  // drawing says which cell each picture is anchored to, and the picture points at the bytes
  // in `xl/media`. Three links to follow, and what they carry is the part of a spreadsheet a
  // grid cannot hold — a photograph of the item, a diagram, a screenshot of a form.
  //
  // The format measures in EMU, 914400 to the inch, which is 9525 to a pixel at the 96 dpi
  // this page draws at.
  const EMU = 9525;

  // What the browser can draw. A workbook may also carry .emf or .wmf, which no browser
  // draws: those are left out rather than shown as a broken frame.
  const PICTURE_TYPES = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml",
  };

  function childNamed(node, name) {
    for (const child of node.children) {
      if (child.localName === name) return child;
    }
    return null;
  }

  // The drawing parts are written with prefixes — `xdr:oneCellAnchor` in one namespace and
  // `a:blip` in another — and `getElementsByTagName` in an XML document matches the prefix
  // as well as the name, so the name alone is matched here.
  function local(node, name) {
    return Array.from(node.getElementsByTagName("*")).filter((el) => el.localName === name);
  }

  // "xl/drawings/drawing1.xml" + "../media/image1.png" → "xl/media/image1.png"
  function resolvePart(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const step of target.split("/")) {
      if (step === "..") parts.pop();
      else if (step !== "." && step !== "") parts.push(step);
    }
    return parts.join("/");
  }

  // One part's own index of the parts it points at: an id, what kind of thing it is, and
  // where that thing lives, written relative to the part that names it.
  async function relationships(zip, part) {
    const cut = part.lastIndexOf("/");
    const bytes = await zip.read(part.slice(0, cut) + "/_rels/" + part.slice(cut + 1) + ".rels");
    const map = new Map();
    if (!bytes) return map;
    for (const rel of all(parse(bytes), "Relationship")) {
      let target = rel.getAttribute("Target") || "";
      try {
        target = decodeURIComponent(target);
      } catch (e) { /* a target that is not escaped needs no decoding */ }
      map.set(rel.getAttribute("Id"), {
        type: rel.getAttribute("Type") || "",
        target: resolvePart(part, target),
      });
    }
    return map;
  }

  // Where a picture is anchored: a cell, and how far into it. A `oneCellAnchor` also says how
  // big the picture is; a `twoCellAnchor` names the cell its far corner is in and lets the
  // grid decide, which is what a picture meant to cover its cells needs.
  function spot(anchor) {
    if (!anchor) return null;
    const at = (name) => {
      const node = childNamed(anchor, name);
      return node ? Number(node.textContent) || 0 : 0;
    };
    return { col: at("col"), colOff: at("colOff"), row: at("row"), rowOff: at("rowOff") };
  }

  // The picture's bytes, once per part: the same logo anchored on fifteen sheets is one
  // image, and a URL per placement would be fifteen copies of it.
  async function pictureUrl(zip, target, media) {
    const kind = target.slice(target.lastIndexOf(".") + 1).toLowerCase();
    const type = PICTURE_TYPES[kind];
    if (!type) return null;
    if (media.has(target)) return media.get(target);
    const bytes = await zip.read(target);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: type }));
    media.set(target, url);
    return url;
  }

  async function readPictures(zip, part, media) {
    const rels = await relationships(zip, part);
    const drawing = Array.from(rels.values()).find((rel) => /\/drawing$/.test(rel.type));
    if (!drawing) return [];
    const bytes = await zip.read(drawing.target);
    if (!bytes) return [];
    const doc = parse(bytes);
    const parts = await relationships(zip, drawing.target);
    const pictures = [];
    const anchors = local(doc, "oneCellAnchor").concat(local(doc, "twoCellAnchor"));
    for (const anchor of anchors) {
      const pic = local(anchor, "pic")[0];
      // a shape or a chart frame is not a picture; this section draws pictures
      if (!pic) continue;
      const blip = local(pic, "blip")[0];
      const embed = blip && (blip.getAttribute("r:embed") ||
        blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"));
      const target = embed && parts.get(embed);
      const url = target && (await pictureUrl(zip, target.target, media));
      if (!url) continue;
      const ext = childNamed(anchor, "ext");
      const name = local(pic, "cNvPr")[0];
      pictures.push({
        from: spot(childNamed(anchor, "from")),
        to: spot(childNamed(anchor, "to")),
        cx: ext ? Number(ext.getAttribute("cx")) || 0 : 0,
        cy: ext ? Number(ext.getAttribute("cy")) || 0 : 0,
        url: url,
        alt: (name && name.getAttribute("descr")) || "",
      });
    }
    return pictures;
  }

  // A picture is content of the sheet, so it counts toward the sheet's extent: a sheet can
  // hold nothing but pictures — a gallery of photographs with a thousand empty rows written
  // around them — and a grid that stopped at the last line of text would open on "This sheet
  // is empty." while the file is megabytes of photographs.
  function withPictures(range, pictures) {
    if (!pictures || !pictures.length) return range;
    let first = Infinity;
    let last = -Infinity;
    for (const picture of pictures) {
      const top = picture.from.row;
      const bottom = picture.to ? picture.to.row : picture.from.row;
      if (top < first) first = top;
      if (bottom > last) last = bottom;
    }
    if (range.last < range.first) return { first: Math.max(0, first), last: last };
    return { first: Math.min(range.first, first), last: Math.max(range.last, last) };
  }

  /* ------------------------------------------------------------ remembered -- */

  // A workbook is opened to look at one of its sheets, and the strip of tabs is the file's
  // own table of contents: coming back to the file and being shown the first sheet means
  // finding the tab again every time. What is kept is the sheet's *name* and not its
  // position, because the file decides the position — a sheet inserted in front of the one
  // the reader was on would otherwise open the workbook on its neighbour.
  //
  // `localStorage` and read synchronously, unlike the note pages' records: this decides
  // which table to draw, and a record that lands after the first paint is a first sheet the
  // reader is shown and did not ask for. It is the store this page already reads its theme
  // from, and the key is shaped like the note pages' own records — one per file, addressed
  // by the page without its fragment.
  const SHEET_PREFIX = "mdview:sheet:";

  function sheetKey() {
    try {
      const u = new URL(location.href);
      return SHEET_PREFIX + u.origin + u.pathname;
    } catch (e) {
      return SHEET_PREFIX + location.href.split("#")[0];
    }
  }

  function rememberedSheet() {
    try {
      return localStorage.getItem(sheetKey()) || null;
    } catch (e) {
      return null; // opaque origin: no memory between documents
    }
  }

  function rememberSheet(name) {
    try {
      localStorage.setItem(sheetKey(), name);
    } catch (e) { /* not remembered, not a problem */ }
  }

  /* ------------------------------------------------------------------ main -- */

  async function show(host) {
    const url = host.getAttribute("data-src");
    const kind = (host.getAttribute("data-kind") || "").toLowerCase();
    const name = (host.getAttribute("data-name") || "").replace(/\.[^.]+$/, "");
    const delimited = kind === "csv" || kind === "tsv";
    const view = document.createElement("div");
    view.className = "sheet-view";
    host.textContent = "";
    host.appendChild(view);

    let sheets;
    let load;
    // the pictures' bytes, made into URLs once: the same image anchored on several sheets is
    // read and decoded once, and the page lives as long as the file does
    const media = new Map();
    if (delimited) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("the reader could not read the file (HTTP " + response.status + ")");
      const parsed = parseDelimited(await response.text(), kind === "tsv" ? "\t" : ",");
      sheets = [{ name: name || "Sheet1", part: null }];
      load = () => Promise.resolve(parsed);
    } else {
      const zip = await openZip(url);
      const book = await workbookSheets(zip);
      sheets = book.sheets;
      if (!sheets.length) throw new Error("the workbook has no sheets in it");
      const shared = await sharedStrings(zip);
      // The styles and the colour scheme are the other half of the file: what a cell is worth
      // is in the worksheet, and what it is meant to look like is here. A workbook can have
      // neither of them, and then every cell is shown as its own value and nothing else.
      const styles = readStyles(await zip.read("xl/styles.xml"),
        readTheme(await zip.read("xl/theme/theme1.xml")));
      const seen = new Map();
      load = async (index) => {
        // a sheet is read the first time it is shown and kept: switching tabs is the
        // common move, and re-inflating a sheet to look at it twice is pure waste
        if (!seen.has(index)) {
          const sheet = readSheet(await zip.read(sheets[index].part), shared, styles, book.date1904);
          sheet.pictures = await readPictures(zip, sheets[index].part, media);
          // a picture is content: the grid grows to the columns the pictures sit on, or a
          // sheet that holds nothing but photographs is shown one column wide
          for (const picture of sheet.pictures) {
            const col = picture.to ? picture.to.col : picture.from.col;
            sheet.width = Math.max(sheet.width, col + 1);
          }
          seen.set(index, sheet);
        }
        return seen.get(index);
      };
    }

    // the sheet this file was last read on, if it still has one by that name: a workbook
    // whose sheets have been renamed around the record opens on its first sheet again
    let active = 0;
    let wantHead = true;
    if (sheets.length > 1) {
      const remembered = sheets.findIndex((sheet) => sheet.name === rememberedSheet());
      if (remembered > 0) active = remembered;
    }

    function title() {
      return (name ? name + " · " : "") + sheets[active].name;
    }

    function paint() {
      view.textContent = "";
      view.appendChild(
        toolbar(sheets, active, wantHead, (index) => {
          if (index === active) return;
          active = index;
          rememberSheet(sheets[active].name);
          document.title = title();
          paint();
        }, (button) => {
          wantHead = !wantHead;
          button.classList.toggle("on", wantHead);
          button.setAttribute("aria-pressed", wantHead ? "true" : "false");
          draw();
        })
      );
      const box = document.createElement("div");
      box.className = "sheet-box";
      box.id = "sheet-box";
      box.appendChild(note("Opening…"));
      view.appendChild(box);
      draw();
    }

    // The strip of tabs scrolls, and every redraw rebuilds it from its left edge: without
    // this, picking a sheet from the far end of a workbook leaves the name of the sheet
    // you are now on off the screen. `scrollIntoView` will not do it — it walks every
    // scroller above the tab as well, and the table arriving under the bar moves the strip
    // back out from under it — so the distance is measured instead.
    //
    // It runs at the end of `draw`, and not with the rest of the redraw, because the
    // status line is written into the same bar: until it is, the strip is as wide as the
    // space that line has not yet taken, and a tab measured against that width is a tab
    // the reader does not end up being shown.
    function revealActive() {
      const strip = view.querySelector(".sheet-tabs");
      const tab = strip && strip.querySelector(".sheet-tab.on");
      if (!tab) return;
      const bar = strip.getBoundingClientRect();
      const on = tab.getBoundingClientRect();
      if (on.left < bar.left) strip.scrollLeft -= bar.left - on.left + 4;
      else if (on.right > bar.right) strip.scrollLeft += on.right - bar.right + 4;
    }

    function draw() {
      return load(active).then((sheet) => {
        const box = document.getElementById("sheet-box");
        if (!box) return;
        box.textContent = "";
        // blank rows above and below the writing are not the sheet a reader came for, and a
        // workbook usually ends in a long tail of them; the row numbers still say which rows
        // are shown, so nothing is hidden by leaving them out — and a picture the file
        // anchored outside the writing is not blank, so the grid grows to it
        const content = contentRange(sheet.rows);
        const range = withPictures(content, sheet.pictures);
        if (range.last < range.first) {
          box.appendChild(note("This sheet is empty."));
        } else {
          const built = renderTable(sheet, wantHead, range, content);
          const scroll = document.createElement("div");
          scroll.className = "sheet-scroll at-start";
          scroll.appendChild(built.table);
          // the pinned row numbers cast their shadow only while the columns are sliding
          // under them, and the scroll box is the only thing that knows which it is
          scroll.addEventListener("scroll", () => {
            scroll.classList.toggle("at-start", scroll.scrollLeft <= 0);
          });
          box.appendChild(scroll);
          pinFrozen(built.table, sheet);
          placePictures(scroll, built.table, sheet.pictures);
          if (built.shown < built.total) {
            box.appendChild(note("Showing the first " + built.shown.toLocaleString() + " of " +
              built.total.toLocaleString() + " rows with writing in them."));
          }
        }
        const status = document.getElementById("sheet-status");
        if (status) {
          // what the grid holds, and the file's own row count beside it when the two differ:
          // the rows with writing in them are the ones a reader can use, and the file's count
          // is what the row numbers on the left are numbered from
          const whole = sheet.rows.length;
          const lines = Math.max(0, range.last - range.first + 1);
          status.textContent = lines.toLocaleString() + (lines === 1 ? " row" : " rows") +
            (lines && lines !== whole ? " of " + whole.toLocaleString() : "") +
            " × " + Math.max(sheet.width, 1) + (sheet.width === 1 ? " column" : " columns") +
            (sheets.length > 1 ? " · sheet " + (active + 1) + " of " + sheets.length : "") +
            (sheets[active].hidden ? " · hidden in the file" : "");
        }
        revealActive();
      }, (error) => {
        // a sheet that cannot be read is the reader's problem, not the workbook's: the
        // tab stays, and the message lands where the table would have been
        const box = document.getElementById("sheet-box");
        if (box) {
          box.textContent = "";
          box.appendChild(note(String((error && error.message) || error), "bad"));
        }
      });
    }

    paint();
    document.title = title();
  }

  function main() {
    const host = document.getElementById("sheet");
    if (!host) return;
    // The same lookup card the note pages carry, over the grid: a spreadsheet is mostly
    // words — headings, notes, names — and looking one up should not mean copying it out
    // to a note first. The root is the grid and not the page, because the sheet tabs and
    // the status line are the reader's own chrome rather than anything the file wrote.
    // It is a selector and not an element: the grid is built later, and every lookup asks
    // it again. What lookup.js hears is the reader's own double-click or drag, and a cell
    // is ordinary text in an ordinary table cell, so the browser already knows the word.
    if (window.MdviewLookup) {
      window.MdviewLookup.setRoot("#sheet .sheet-scroll");
      window.MdviewLookup.attach(document, { neighbours: false });
    }
    show(host).catch((error) => {
      // nothing has been drawn yet, so the failure is the page: say what went wrong in
      // the place the table would have been, rather than leaving "Opening…" forever
      host.textContent = "";
      host.appendChild(note(String((error && error.message) || error), "bad"));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();

// The reader's PDF view. A page of a PDF is two things laid over each other: a paint — a
// canvas of pixels — and the file's own text, invisible, sitting exactly over the words so
// the pointer can select them and the lookup card can read them.
//
// Two facts shape this file. The first is that the paint is expensive and the text is not.
// A twelve-hundred-page scan is a gigabyte of canvas, and the browser dies long before the
// last page; the reader this replaced drew every page before it drew anything else, so a
// long book was a blank window for minutes and a short one lost its lookup card until the
// last page had finished. So every page gets its box, at the size the file says, as soon as
// the file opens — that is what the scrollbar and the page count are made of — and only the
// pages near the reader are painted, a small window kept and released behind them.
//
// The second is that a reader's place in a long file is worth keeping, the way a note's is.
// It is stored as a page and the fraction of that page scrolled past, so a resize or another
// window reopens the file at the same words rather than at the same pixels.
//
// Both of those, and the paint itself, borrow the shape Bookshelf's reader worked out the
// hard way (reader/scroll.js, reader/zoom.js, reader/utils.js): a page painted at the right
// pixel density with its images smoothed, a canvas ceiling that fails soft instead of blank,
// and a budget counted in bytes rather than pages, because the same page is 3.7MB at one
// device pixel per CSS pixel and 17MB at two.

import * as pdfjs from "/static/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/static/pdf.worker.mjs";

// The widest a page is drawn at fit width. Past 908px a line of a page stops being a line
// and becomes a scan to pan, which is not what a reader wants by default.
const WIDEST = 908;

// The densest a page is painted. Past two device pixels per CSS pixel the paint is more
// memory than the eye can use.
const SHARPEST = 2;

// A window over about a million CSS pixels does not pay the doubling an ordinary screen
// gets: the bitmap is four times the device pixels and the compositor downsamples it on
// every presented frame (Bookshelf's reader measured the tax at 17–45ms a turn against
// 60–120ms, and it is invisible to a main-thread profiler).
const DENSITY_AREA = 1_000_000;

// A canvas past 2^24 pixels is silently blank on iOS Safari rather than an error, and is
// four bytes a pixel everywhere: a page painted past this is scaled back, not lost.
const MAX_CANVAS_PIXELS = 16777216;

// The canvas backing store kept around the reader, in bytes — not a page count (Bookshelf's
// reader/scroll.js, MEMORY_BUDGET_MB). A page is 3.7MB at one device pixel per CSS pixel and
// 17MB at two, so a count is either wasteful on a desktop or fatal on a phone.
const BUDGET = 48 * 1048576;

// How far from the viewport a page is prepared, in viewport heights: about what a reader
// scrolls in the time a page takes to paint. Prepared means its text and its paint.
const NEAR = 1.5;

// Zoom steps multiply rather than snap, the way Firefox's own zoom does (Bookshelf's
// reader/zoom.js): 100 → 110 → 121 → 133, with the exact inverse on the way back.
const ZOOM_STEP = 1.1;
const ZOOM_MIN = 10;
const ZOOM_MAX = 600;

// 100% is a PDF point at four thirds of a CSS pixel: the official viewer's convention, so a
// percentage here means what it means in every other reader.
const NATURAL = 4 / 3;

// Where the reader was in this file: one record per file, per origin, like a note's place.
const PLACE = "mdview:pdf:";

const pages = document.getElementById("pages");
const byBox = new WeakMap();
const state = [];
const control = {};

let zoom = "fit-width"; // "fit-width" | "fit-page" | a percentage
let density = 1; // device pixels per CSS pixel, for the paint
let live = 0; // canvas bytes the reader is holding, for the budget
let moved = 0; // when the reader last scrolled
let frame = 0; // the scroll handler's pending frame
let saving = 0; // the pending write of the reader's place
let resizing = 0; // the pending re-layout

/* ---------------------------------------------------------------- page boxes -- */

// The width a page is drawn at: the column the window gives the pages, capped. It is read
// from the document rather than from the pages' box, because a zoomed page widens that box.
function columnWidth() {
  const room = document.documentElement.clientWidth - 32; // the pages' own 16px on each side
  return Math.max(240, Math.min(room, WIDEST));
}

// The scale one page is drawn at, in CSS pixels per PDF point.
function scaleOf(entry) {
  if (zoom === "fit-page") {
    // The whole page in the window: limited by whichever side runs out first, so a slide
    // does not have its right edge off screen just because its height fit.
    const wide = document.documentElement.clientWidth - 32;
    const tall = document.documentElement.clientHeight - inset() - 32;
    return Math.max(0.05, Math.min(wide / entry.wide, tall / entry.tall));
  }
  if (zoom === "fit-width") return columnWidth() / entry.wide;
  return NATURAL * (zoom / 100);
}

// The density a page's paint is made at — Bookshelf's renderDensity rule. An ordinary
// screen gets two device pixels per CSS pixel, because at one a page of pdf.js text reads
// soft; a sharp screen gets its own ratio. Both are capped, and the doubling is dropped on
// a window big enough to pay for it in compositing.
function renderDensity() {
  const dpr = window.devicePixelRatio || 1;
  const base = dpr < 1.5 ? 2 : dpr;
  const area = (window.innerWidth || 0) * (window.innerHeight || 0);
  return Math.min(SHARPEST, area >= DENSITY_AREA ? dpr : base);
}

// pdf.js honours an image's /Interpolate flag, and with it false — the common default for
// screenshots and figures — a magnified image is drawn as hard pixel blocks. Mainstream
// viewers smooth them anyway, so every context a page is painted on gets its resampling
// raised and its imageSmoothingEnabled shadowed, which is what stops pdf.js turning it off
// again per image (Bookshelf's useSmoothImages).
function useSmoothImages(ctx) {
  ctx.imageSmoothingQuality = "high";
  if (ctx.mdviewSmooth) return;
  try {
    Object.defineProperty(ctx, "imageSmoothingEnabled", {
      configurable: true,
      get: () => true,
      set: () => {},
    });
  } catch (error) {
    /* a context that refuses the shadow keeps the browser default, which is true */
  }
  ctx.mdviewSmooth = true;
}

// The size of every page at the width being drawn. Run when the file opens and when the
// window changes: a page laid out at the old width is a stripe in the new one.
function layout() {
  density = renderDensity();
  let widest = 0;
  for (const entry of state) {
    const view = entry.page.getViewport({ scale: scaleOf(entry) });
    entry.view = view;
    const box = entry.box;
    box.style.width = view.width + "px";
    box.style.height = view.height + "px";
    // The one number pdf.js's text layer cannot work out for itself: the scale the page was
    // drawn at. Every span's size and stretch comes from it; without it the invisible text
    // sits nowhere near the words it belongs to.
    box.style.setProperty("--total-scale-factor", view.scale);
    if (view.width > widest) widest = view.width;
    unpaint(entry);
    untext(entry);
  }
  // A zoomed page can be wider than the window. A centred box wider than its window has
  // nowhere to put the overflow — the left of the page would be off the scrollable area —
  // so the pages' box takes the width the page needs and the body scrolls instead.
  pages.style.maxWidth = "none";
  pages.style.width = Math.max(document.documentElement.clientWidth, Math.ceil(widest) + 32) + "px";
  // The tops are fixed now, so a page count or a jump does not have to ask the layout
  // engine for a thousand rectangles every time the reader scrolls.
  for (const entry of state) {
    entry.top = entry.box.getBoundingClientRect().top + window.scrollY;
  }
}

function unpaint(entry) {
  if (!entry.canvas) return;
  entry.canvas.width = entry.canvas.height = 0; // the pixels go now, not at the next collection
  entry.canvas.remove();
  entry.canvas = null;
  entry.painted = false;
  entry.box.classList.add("waiting");
  live = Math.max(0, live - (entry.bytes || 0));
  entry.bytes = 0;
}

function untext(entry) {
  if (!entry.text) return;
  entry.text.remove();
  entry.text = null;
  entry.texted = false;
}

/* ------------------------------------------------------------------ the paint -- */

// What a page needs to be readable is made in one place, a page at a time: its text, then
// its paint, with at most two pages in flight. The queue matters on a jump — a jump through
// six hundred pages tells the observer about every page it passes, and each of those paints
// is seconds of work the reader will never see — so the page in sight goes first and a page
// that has left the window by the time its turn comes is let go, unwasted.
const queue = [];
let working = 0;

function prepare(entry) {
  if (entry.queued || (entry.painted && entry.texted)) return;
  entry.queued = true;
  queue.push(entry);
  const eye = window.innerHeight / 2;
  queue.sort((a, b) => Math.abs(center(a) - eye) - Math.abs(center(b) - eye));
  pump();
}

function pump() {
  while (working < 2 && queue.length) {
    const entry = queue.shift();
    entry.queued = false;
    if (entry.painted && entry.texted) continue;
    if (!near(entry)) continue; // gone while it waited: the observer will call again
    working++;
    (async () => {
      await read(entry);
      await paint(entry);
    })().finally(() => {
      working--;
      pump();
    });
  }
}

async function paint(entry) {
  const view = entry.view;
  if (!view || entry.painted || entry.painting) return;
  entry.painting = true;
  try {
    // Two guards on the way a page becomes pixels: the density it is painted at, and a
    // ceiling on how many pixels one canvas may hold. A page over the ceiling is painted
    // slightly softer rather than not at all.
    const wanted = view.width * density;
    const fit = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, wanted * wanted * (view.height / view.width))));
    const sharp = entry.page.getViewport({ scale: view.scale * density * fit });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(sharp.width);
    canvas.height = Math.floor(sharp.height);
    canvas.style.width = view.width + "px";
    canvas.style.height = view.height + "px";
    const context = canvas.getContext("2d");
    useSmoothImages(context);
    await entry.page.render({ canvasContext: context, viewport: sharp }).promise;
    if (entry.view !== view) return; // the window changed while this painted: let it go
    entry.canvas = canvas;
    entry.bytes = canvas.width * canvas.height * 4;
    live += entry.bytes;
    entry.painted = true;
    entry.box.classList.remove("waiting");
    entry.box.prepend(canvas);
    keepAway(entry);
  } catch (error) {
    entry.box.classList.remove("waiting");
    entry.box.classList.add("pdf-bad");
    entry.box.title = "This page could not be drawn: " + ((error && error.message) || error);
  } finally {
    entry.painting = false;
    // a paint that was overtaken by a resize left nothing behind, and no observer will
    // fire for a page that is already in sight: if it still is, it is painted again now
    if (entry.view !== view && entry.view && near(entry)) prepare(entry);
  }
}

function center(entry) {
  const box = entry.box.getBoundingClientRect();
  return box.top + box.height / 2;
}

// Whether a page is within the window the reader's scrolling reaches.
function near(entry) {
  const box = entry.box.getBoundingClientRect();
  const tall = window.innerHeight;
  return box.bottom > -tall * NEAR && box.top < tall * (1 + NEAR);
}

// Whether the reader is looking at a page: it touches the window, not merely the margin
// around it.
function touches(entry) {
  const box = entry.box.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

// A painted page is megabytes, so the reader holds a budget of them and releases the ones
// farthest from the eye first; the box keeps its place and scrolling back paints it again.
// A page the reader is looking at is never released — that is the difference between a
// working reader and a render/drop loop, because releasing it only makes the next tick
// paint it again, over budget, and release something else (Bookshelf's reader/scroll.js
// says two pages in view at a high zoom can exceed the whole budget; overshooting is the
// correct outcome then, and pixels the reader is looking at win).
function keepAway(current) {
  if (live <= BUDGET) return;
  const eye = window.innerHeight / 2;
  const away = state
    .filter((entry) => entry.painted && entry !== current && !touches(entry))
    .sort((a, b) => Math.abs(center(b) - eye) - Math.abs(center(a) - eye));
  for (const entry of away) {
    if (live <= BUDGET) break;
    unpaint(entry);
  }
}

async function read(entry) {
  const view = entry.view;
  if (!view || entry.texted || entry.reading) return;
  entry.reading = true;
  try {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    entry.box.appendChild(layer);
    await new pdfjs.TextLayer({
      textContentSource: entry.page.streamTextContent(),
      container: layer,
      viewport: view,
    }).render();
    if (entry.view !== view) {
      layer.remove(); // laid out at a size the page no longer has
      return;
    }
    entry.text = layer;
    entry.texted = true;
  } catch (error) {
    /* a page whose text cannot be read still has its paint, and its words are still there */
  } finally {
    entry.reading = false;
    if (entry.view !== view && entry.view && near(entry)) prepare(entry);
  }
}

// The pages coming into reach are prepared the moment they do, the one in sight first: a
// reader scrolling into a new screen wants that screen, not the one above it that entered
// the margin at the same moment.
const watcher = new IntersectionObserver(
  (items) => {
    const eye = window.innerHeight / 2;
    const due = [];
    for (const item of items) {
      if (!item.isIntersecting) continue;
      const entry = byBox.get(item.target);
      if (entry) due.push(entry);
    }
    due.sort((a, b) => Math.abs(center(a) - eye) - Math.abs(center(b) - eye));
    for (const entry of due) prepare(entry);
  },
  { rootMargin: `${Math.round(NEAR * 100)}% 0px` },
);

/* ------------------------------------------------------------- the reader's place -- */

function placeKey() {
  return PLACE + location.origin + location.pathname;
}

// The reader's bar sits over the file (it is sticky), so a page that is at the top of the
// window is under the bar; "at the top" here means the page's own top is just below it.
function inset() {
  const bar = document.querySelector("nav.bar");
  return bar ? bar.offsetHeight : 0;
}

// The page under the reading line — a quarter of the screen down, where the eye is when a
// page opens — so a page taller than the window stays the current one while it is read.
function currentIndex() {
  const line = window.scrollY + inset() + Math.min(window.innerHeight * 0.3, 240);
  let low = 0;
  let high = state.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (state[mid].top <= line) low = mid;
    else high = mid - 1;
  }
  return low;
}

function place() {
  if (!state.length) return null;
  const index = currentIndex();
  const box = state[index].box.getBoundingClientRect();
  // How far into the page the reader is, measured from the place the page arrives at when
  // it is jumped to (its top just under the bar). It is negative when the page has not
  // arrived yet — the previous page's foot is still above it, which is ordinary reading —
  // and that is what keeps a zoom or a resize from drifting by the pages' padding.
  return {
    page: index + 1,
    at: Math.max(-1, Math.min(1, (inset() - box.top) / Math.max(1, box.height))),
    zoom,
    v: 2, // the meaning of `at` (below); a record without it is read the old way
  };
}

function goTo(index, at = 0, smooth = false) {
  const entry = state[Math.max(0, Math.min(state.length - 1, index))];
  if (!entry) return;
  const top = entry.top - inset() + Math.max(-1, Math.min(1, at)) * entry.box.offsetHeight;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}

function remember() {
  const at = place();
  if (!at) return;
  try {
    localStorage.setItem(placeKey(), JSON.stringify(at));
  } catch (error) {
    /* a store that refuses is not the reader's problem */
  }
}

function savedPlace() {
  try {
    return JSON.parse(localStorage.getItem(placeKey()) || "null");
  } catch (error) {
    return null;
  }
}

function clampZoom(value) {
  if (value === "fit-width" || value === "fit-page") return value;
  const pct = parseInt(value, 10);
  if (!Number.isFinite(pct)) return "fit-width";
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pct));
}

/* -------------------------------------------------------------------- the hand -- */

// A PDF bigger than the window is moved with the hand, the way a picture is: the pages
// are not a picture, but they are bigger than the window in the same way, and a reader
// who has zoomed in wants to take the page with the pointer rather than find the
// scrollbar.
//
// A drag that starts on a word is a selection and not a move — the words still have to
// be choosable, for the lookup and for copying — so the hand takes the page around
// them. The middle button takes the words as well, for the reader who wants to move
// the page whatever is under the pointer.
let hand = null;

pages.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") return; // a finger scrolls, as it should
  if (event.button !== 0 && event.button !== 1) return;
  if (event.button === 0) {
    const on = event.target && event.target.closest ? event.target.closest(".textLayer span, a") : null;
    if (on) return;
  }
  hand = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try {
    pages.setPointerCapture(event.pointerId);
  } catch (error) {
    /* a pointer that cannot be captured still moves the page */
  }
  document.body.classList.add("pdf-holding");
  event.preventDefault();
});

pages.addEventListener("pointermove", (event) => {
  if (!hand || hand.id !== event.pointerId) return;
  window.scrollBy(-(event.clientX - hand.x), -(event.clientY - hand.y));
  hand.x = event.clientX;
  hand.y = event.clientY;
});

const releaseHand = (event) => {
  if (!hand || hand.id !== event.pointerId) return;
  hand = null;
  document.body.classList.remove("pdf-holding");
};

pages.addEventListener("pointerup", releaseHand);
pages.addEventListener("pointercancel", releaseHand);

/* ------------------------------------------------------------- the page count -- */

function controls(total) {
  // The reader's own tools, in a bar of their own. They used to live in the bar at the
  // top of the page, which is not there when the file is read in a frame — and a PDF
  // with no way to turn its pages is a PDF that can only be scrolled, which is no way
  // to read a deck with.
  const nav = document.createElement("div");
  nav.className = "pdf-nav";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-label", "pages");

  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "‹";
  back.title = "Previous page";
  back.setAttribute("aria-label", "Previous page");
  back.addEventListener("click", () => goTo(currentIndex() - 1, 0, maySmooth()));

  const count = document.createElement("input");
  count.type = "text";
  count.inputMode = "numeric";
  count.value = "1";
  count.setAttribute("aria-label", "Page number");
  count.addEventListener("focus", () => count.select());
  count.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    jump(count.value);
    count.blur();
  });
  count.addEventListener("change", () => jump(count.value));

  const ahead = document.createElement("button");
  ahead.type = "button";
  ahead.textContent = "›";
  ahead.title = "Next page";
  ahead.setAttribute("aria-label", "Next page");
  ahead.addEventListener("click", () => goTo(currentIndex() + 1, 0, maySmooth()));

  const of = document.createElement("span");
  of.className = "of";
  of.textContent = "of " + total;

  const sep = document.createElement("span");
  sep.className = "sep";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.textContent = "−";
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  zoomOut.addEventListener("click", () => stepZoom(-1));

  const pick = document.createElement("select");
  pick.setAttribute("aria-label", "Zoom");
  pick.title = "Zoom level";
  for (const [value, label] of [
    ["fit-width", "Fit width"],
    ["fit-page", "Fit page"],
    ["50", "50%"],
    ["75", "75%"],
    ["100", "100%"],
    ["125", "125%"],
    ["150", "150%"],
    ["200", "200%"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    pick.appendChild(option);
  }
  pick.addEventListener("change", () => setZoom(pick.value));

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";
  zoomIn.title = "Zoom in";
  zoomIn.setAttribute("aria-label", "Zoom in");
  zoomIn.addEventListener("click", () => stepZoom(1));

  // A one-page file has no pages to turn, but it does have a page to read: the zoom stays
  // and the page count goes, rather than leaving a one-page file with no controls at all.
  if (total < 2) back.hidden = count.hidden = of.hidden = ahead.hidden = sep.hidden = true;

  nav.append(back, count, of, ahead, sep, zoomOut, pick, zoomIn);
  document.body.appendChild(nav);
  Object.assign(control, { back, ahead, count, pick });
}

// A percentage the layout is currently drawing at, so ± from a fitted page starts where the
// page is rather than at a nominal 100%.
function currentPct() {
  const entry = state[currentIndex()];
  if (!entry || !entry.view) return 100;
  return Math.round((entry.view.scale / NATURAL) * 100);
}

function stepZoom(direction) {
  const now = currentPct();
  let next = direction > 0 ? Math.round(now * ZOOM_STEP) : Math.round(now / ZOOM_STEP);
  if (direction > 0 && next <= now) next = now + 1; // a no-op step at the top
  if (direction < 0 && next >= now) next = now - 1; // and at the bottom
  setZoom(String(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))));
}

// A zoom is a re-layout: the pages take a new size, their paints and text layers are made
// again as the reader reaches them, and the place in the file is kept because it is a page
// and a fraction of it, not a scroll offset.
function setZoom(value) {
  const next = clampZoom(value);
  if (next === zoom) {
    syncZoom();
    return;
  }
  const at = place();
  zoom = next;
  layout();
  if (at) goTo(at.page - 1, at.at);
  for (const entry of state) if (near(entry)) prepare(entry);
  syncZoom();
  show();
  remember();
}

// The select shows the level the pages are actually at. A step lands on a value with no
// preset, so it is given one rather than silently showing the nearest wrong number
// (Bookshelf's syncZoomUI).
let pickExtra = null;

function syncZoom() {
  if (!control.pick) return;
  const preset = control.pick.querySelector(`option[value="${zoom}"]`);
  if (preset) {
    control.pick.value = String(zoom);
    if (pickExtra) {
      pickExtra.remove();
      pickExtra = null;
    }
    return;
  }
  const pct = String(currentPct());
  if (!pickExtra) {
    pickExtra = document.createElement("option");
    control.pick.appendChild(pickExtra);
  }
  pickExtra.value = pct;
  pickExtra.textContent = pct + "%";
  control.pick.value = pct;
}

function maySmooth() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function jump(value) {
  const page = parseInt(value, 10);
  if (!Number.isFinite(page)) {
    show();
    return;
  }
  goTo(page - 1, 0);
}

function show() {
  if (!control.count) return;
  const index = currentIndex();
  if (document.activeElement !== control.count) control.count.value = String(index + 1);
  control.back.disabled = index <= 0;
  control.ahead.disabled = index >= state.length - 1;
}

/* -------------------------------------------------------------------- opening -- */

// Everything the file's own text is not: headings, a search inside a page, all of it in the
// page's own words, slowly, while the reader is still.
function fill() {
  if (document.hidden || performance.now() - moved < 900) {
    idle(fill);
    return;
  }
  const next = state.find((entry) => entry.view && !entry.texted && !entry.reading);
  if (!next) {
    if (state.some((entry) => entry.reading)) idle(fill);
    return;
  }
  read(next).then(() => idle(fill));
}

// The browser's find-in-page reads the text layer, and a text layer is only made for the
// pages near the reader. So the rest are made in idle time, one at a time, and never while
// the reader is moving: find reaches the whole file a little after it opens, rather than
// only the part the reader has scrolled past.
function idle(again) {
  const run = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
  run(again, { timeout: 3000 });
}

async function open() {
  const note = document.getElementById("note");
  const source = pages.dataset.src;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`the file could not be read (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data: bytes,
    cMapUrl: "/static/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/static/standard_fonts/",
    wasmUrl: "/static/wasm/",
    isEvalSupported: false,
  }).promise;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const box = document.createElement("section");
    box.className = "pdfpage waiting";
    box.dataset.page = String(n);
    box.setAttribute("aria-label", `page ${n} of ${doc.numPages}`);
    pages.appendChild(box);
    const natural = page.getViewport({ scale: 1 });
    const entry = {
      n,
      page,
      box,
      wide: natural.width,
      tall: natural.height,
      top: 0,
      bytes: 0,
    };
    byBox.set(box, entry);
    state.push(entry);
  }

  if (note) note.remove(); // before the tops are measured: the boxes move up when it goes
  const saved = savedPlace();
  if (saved && saved.zoom) zoom = clampZoom(saved.zoom);
  layout();
  controls(doc.numPages);
  syncZoom();
  if (saved && saved.page) {
    // `at` used to be measured the other way round (how far the page's top sat below the
    // bar). A place written by that reader is still a place worth keeping: mirror it.
    const at = saved.v === 2 ? saved.at || 0 : -(saved.at || 0);
    goTo(saved.page - 1, at);
  }
  for (const entry of state) watcher.observe(entry.box);
  show();
  fill();

  window.addEventListener(
    "scroll",
    () => {
      moved = performance.now();
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          show();
        });
      }
      clearTimeout(saving);
      saving = setTimeout(remember, 500);
    },
    { passive: true },
  );

  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizing);
      resizing = setTimeout(() => {
        const at = place();
        layout();
        if (at) goTo(at.page - 1, at.at);
        for (const entry of state) if (near(entry)) prepare(entry);
        show();
      }, 200);
    },
    { passive: true },
  );

  window.addEventListener("pagehide", remember);
}

if (pages && pages.dataset.src) {
  open().catch((error) => {
    const note = document.getElementById("note");
    const why = (error && error.message) || String(error);
    if (note) note.textContent = "This PDF could not be opened: " + why;
  });
}

// The image viewer: a picture at its own size, a hand to move it with, and a way in
// and out of it.
//
// The picture is drawn at its own pixels and no bigger — a large image is not shrunk
// to fit the window, because a shrunk image is a soft one. What is bigger than the
// window is moved with the hand instead, and the zoom takes it in and out.

(function () {
  "use strict";

  const main = document.querySelector(".imgview");
  if (!main) return;
  const stage = main.querySelector(".imgview-stage");
  const img = main.querySelector(".imgview-img");
  const level = main.querySelector(".imgview-level");
  const size = main.querySelector(".imgview-size");

  // The steps the zoom takes. Each one is a size a person would ask for.
  const ZOOMS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];

  let scale = 1;
  let x = 0;
  let y = 0;
  let natural = { w: 0, h: 0 };
  let hand = null; // the pointer that is moving the picture

  // ── The picture on the stage ──────────────────────────────────────────────

  function apply() {
    img.style.transform = "translate(" + x + "px," + y + "px) scale(" + scale + ")";
    level.textContent = Math.round(scale * 100) + "%";
    // At a whole number of times the size, the picture is made of squares and the
    // squares stay squares: no smoothing between them.
    const whole = Math.abs(scale - Math.round(scale)) < 0.001;
    img.style.imageRendering = whole && scale >= 2 ? "pixelated" : "auto";
    const wide = scale * natural.w > stage.clientWidth + 1;
    const tall = scale * natural.h > stage.clientHeight + 1;
    main.classList.toggle("pannable", wide || tall);
  }

  // The picture's place on the stage: in the middle when it fits, and at the edge
  // when it does not, so that it cannot be lost off the side.
  function settle() {
    const w = scale * natural.w;
    const h = scale * natural.h;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    x = w <= sw ? Math.round((sw - w) / 2) : Math.min(0, Math.max(sw - w, x));
    y = h <= sh ? Math.round((sh - h) / 2) : Math.min(0, Math.max(sh - h, y));
  }

  function place() {
    settle();
    apply();
  }

  // ── The zoom ──────────────────────────────────────────────────────────────

  // A zoom about a point: what is under the cursor stays under the cursor.
  function zoomTo(next, px, py) {
    const from = scale;
    scale = Math.min(16, Math.max(0.1, next));
    if (scale === from) return;
    if (px == null || py == null) {
      const r = stage.getBoundingClientRect();
      px = r.width / 2;
      py = r.height / 2;
    }
    x = px - ((px - x) * scale) / from;
    y = py - ((py - y) * scale) / from;
    place();
  }

  function zoomStep(direction, px, py) {
    let at = 0;
    for (let i = 0; i < ZOOMS.length; i++) {
      if (ZOOMS[i] <= scale + 0.0001) at = i;
    }
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + direction))];
    zoomTo(next, px, py);
  }

  // The whole picture in the window, at its own size at the largest: never blown up.
  function fit() {
    if (!natural.w || !natural.h) return;
    scale = Math.min(stage.clientWidth / natural.w, stage.clientHeight / natural.h, 1);
    x = 0;
    y = 0;
    place();
  }

  // The picture at its own pixels.
  function oneToOne() {
    zoomTo(1, null, null);
  }

  // ── The hand ──────────────────────────────────────────────────────────────

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    hand = { id: e.pointerId, x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    main.classList.add("holding");
    e.preventDefault();
  });

  stage.addEventListener("pointermove", (e) => {
    if (!hand || hand.id !== e.pointerId) return;
    x += e.clientX - hand.x;
    y += e.clientY - hand.y;
    hand.x = e.clientX;
    hand.y = e.clientY;
    settle();
    apply();
  });

  const letGo = (e) => {
    if (!hand || hand.id !== e.pointerId) return;
    hand = null;
    main.classList.remove("holding");
  };
  stage.addEventListener("pointerup", letGo);
  stage.addEventListener("pointercancel", letGo);

  // The wheel moves the picture; with the zoom key held it zooms instead, about
  // the place the pointer is at.
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey) {
      zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), px, py);
      return;
    }
    x -= e.deltaX;
    y -= e.deltaY;
    settle();
    apply();
  }, { passive: false });

  // A double click goes in and out: the whole picture, or its own pixels.
  stage.addEventListener("dblclick", (e) => {
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (scale === 1) {
      fit();
    } else {
      zoomTo(1, px, py);
    }
  });

  // ── The buttons ───────────────────────────────────────────────────────────

  main.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "in") zoomStep(1);
    else if (act === "out") zoomStep(-1);
    else if (act === "fit") fit();
    else if (act === "one") oneToOne();
    else if (act === "level") {
      // The level itself: back to the picture at its own size.
      oneToOne();
    }
  });

  // The keys, for the hands that like them.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") {
      zoomStep(1);
      e.preventDefault();
    } else if (e.key === "-" || e.key === "_") {
      zoomStep(-1);
      e.preventDefault();
    } else if (e.key === "0") {
      fit();
      e.preventDefault();
    } else if (e.key === "1") {
      oneToOne();
      e.preventDefault();
    }
  });

  // ── The picture itself ────────────────────────────────────────────────────

  img.addEventListener("load", () => {
    natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    if (size) {
      size.textContent = natural.w + " × " + natural.h + " px";
    }
    place();
  });

  if (img.complete && img.naturalWidth) {
    natural = { w: img.naturalWidth, h: img.naturalHeight };
    if (size) size.textContent = natural.w + " × " + natural.h + " px";
    place();
  }

  window.addEventListener("resize", () => {
    if (scale !== 1) place();
  });
})();

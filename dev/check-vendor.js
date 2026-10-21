#!/usr/bin/env node
// mdview vendored-asset audit: the engine files the reader serves are not ours,
// so nothing in this repo would notice if one drifted, rotted, or was edited
// without the edit being written down.
//
// vendor-manifest.json records, for every vendored asset, the package and
// version it came from, its digest, and how many diff hunks it is allowed to
// differ from upstream by. This turns "is our copy still what we think it is?"
// into something the build runs: a drift stops the build instead of shipping an
// engine whose only symptom is one document type rendering wrong.
//
//   node dev/check-vendor.js                        # offline, digests only
//   node dev/check-vendor.js --upstream             # fetch the packages, diff
//   node dev/check-vendor.js --interfaces           # wasm imports/exports
//   node dev/check-vendor.js --record               # after a deliberate upgrade
//
// --upstream and --record need network; --record must be given deliberately.
// --interfaces needs wabt's `wasm-objdump` (WABT_BIN_DIRECTORY, or PATH).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const extArg = process.argv.indexOf("--ext");
const ext = extArg !== -1 && process.argv[extArg + 1] ? path.resolve(process.argv[extArg + 1]) : path.join(root, "extension");
const manifestPath = path.join(__dirname, "vendor-manifest.json");
const cache = path.join(os.homedir(), ".cache", "mdview-vendor");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const upstream = has("--upstream");
const record = has("--record");
const interfaces = has("--interfaces");
const quiet = has("--quiet");

const problems = [];
const notes = [];

/* ------------------------------------------------------------------ digests */

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// A directory digest is the digest of its tree, not of a bag of bytes: names
// and layout matter, so a renamed copy of the right file still counts as drift.
function filesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

function dirDigest(dir) {
  const files = filesUnder(dir);
  const lines = files.map((f) => `${f.rel}\t${sha256(f.abs)}\n`).join("");
  return { files: files.length, digest: crypto.createHash("sha256").update(lines).digest("hex") };
}

/* ------------------------------------------------------------- the manifest */

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`vendor check: no ${path.relative(root, manifestPath)} yet — create it with --record --upstream`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function measure(asset) {
  const abs = path.join(ext, asset.ext);
  if (!fs.existsSync(abs)) return { missing: true };
  return asset.kind === "dir" ? dirDigest(abs) : { files: 1, digest: sha256(abs) };
}

/* ------------------------------------------------------------------- report */

function label(asset) {
  return `${asset.ext} <- ${asset.package}@${asset.version}${asset.upstream ? `:${asset.upstream}` : ""}`;
}

function describe(asset) {
  const bits = [];
  if (asset.patched_hunks) bits.push(`${asset.patched_hunks} local hunk(s)`);
  if (asset.mode === "subset") bits.push("intentional subset");
  return bits.length ? ` [${bits.join(", ")}]` : "";
}

/* ------------------------------------------------------- offline: digests */

function checkDigests(manifest) {
  let ok = 0;
  for (const asset of manifest.assets) {
    const got = measure(asset);
    if (got.missing) {
      problems.push(`${asset.ext} is missing (recorded ${asset.files} file(s))`);
      continue;
    }
    if (got.files !== asset.files) {
      problems.push(`${asset.ext}: ${got.files} file(s), recorded ${asset.files}`);
      continue;
    }
    if (got.digest !== asset.digest) {
      problems.push(`${asset.ext} digest changed — ${got.digest.slice(0, 12)}… vs recorded ${asset.digest.slice(0, 12)}…`);
      continue;
    }
    ok++;
    if (!quiet) console.log(`  ok   ${label(asset)}${describe(asset)}`);
  }
  return ok;
}

/* ------------------------------------------- upstream: fetch, diff, compare */

function unpack(asset) {
  const dir = path.join(cache, `${asset.package}@${asset.version}`);
  const marker = path.join(dir, "package", "package.json");
  if (fs.existsSync(marker)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const tarball = `${asset.package.replace("/", "-")}-${asset.version}.tgz`;
  execFileSync("npm", ["pack", `${asset.package}@${asset.version}`, "--silent"], { cwd: dir, stdio: "pipe" });
  execFileSync("tar", ["xzf", tarball], { cwd: dir, stdio: "pipe" });
  if (!fs.existsSync(marker)) throw new Error(`could not unpack ${asset.package}@${asset.version}`);
  return dir;
}

// diff --unified, hunk count. `diff` exits 1 when files differ, which is normal.
function hunksBetween(upstreamFile, localFile) {
  const run = (args) => {
    try {
      return execFileSync("diff", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
      if (err.status === 1) return err.stdout || "";
      throw err;
    }
  };
  const text = run(["-u", upstreamFile, localFile]);
  return (text.match(/^@@/gm) || []).length;
}

function checkUpstream(manifest, results) {
  for (const asset of manifest.assets) {
    const dir = unpack(asset);
    const upstreamPath = path.join(dir, "package", asset.upstream);
    if (!fs.existsSync(upstreamPath)) {
      problems.push(`${label(asset)}: upstream ${asset.upstream} does not exist in the package`);
      continue;
    }
    if (asset.kind === "file") {
      const hunks = hunksBetween(upstreamPath, path.join(ext, asset.ext));
      results.set(asset.ext, hunks);
      if (record) {
        console.log(`  rec  ${label(asset)} (${hunks ? `${hunks} local hunk(s)` : "identical to upstream"})`);
      } else if (hunks === asset.patched_hunks) {
        if (!quiet) console.log(`  ok   ${label(asset)}${hunks ? ` (${hunks} local hunk(s), expected)` : " (identical to upstream)"}`);
      } else if (hunks > asset.patched_hunks) {
        problems.push(`${label(asset)}: ${hunks} hunk(s) vs upstream, recorded ${asset.patched_hunks} — a new local edit went unrecorded`);
      } else {
        problems.push(`${label(asset)}: ${hunks} hunk(s) vs upstream, recorded ${asset.patched_hunks} — an edit was lost`);
      }
      continue;
    }
    // dirs: every local file must exist upstream and match, byte for byte.
    const local = filesUnder(path.join(ext, asset.ext));
    const extra = [];
    let mismatched = 0;
    for (const file of local) {
      const theirs = path.join(upstreamPath, file.rel);
      if (!fs.existsSync(theirs)) extra.push(file.rel);
      else if (sha256(theirs) !== sha256(file.abs)) mismatched++;
    }
    const upstreamCount = filesUnder(upstreamPath).length;
    if (record) {
      console.log(`  rec  ${label(asset)} (${local.length} of ${upstreamCount} upstream file(s))`);
      continue;
    }
    if (mismatched || (extra.length && asset.mode !== "subset")) {
      problems.push(`${label(asset)}: ${mismatched} file(s) differ from upstream${extra.length ? `, ${extra.length} not in upstream (${extra.slice(0, 3).join(", ")})` : ""}`);
      continue;
    }
    if (asset.mode === "subset") {
      const dropped = upstreamCount - local.length;
      if (dropped < 0) problems.push(`${label(asset)}: ${local.length} file(s) locally vs ${upstreamCount} upstream — subset cannot be larger`);
      else if (!quiet) console.log(`  ok   ${label(asset)} (${local.length} of ${upstreamCount} upstream files, all identical)`);
    } else if (local.length !== upstreamCount) {
      problems.push(`${label(asset)}: ${local.length} file(s) locally vs ${upstreamCount} upstream`);
    } else if (!quiet) {
      console.log(`  ok   ${label(asset)} (${local.length} files, all identical)`);
    }
  }
}

/* ------------------------------------------------- wasm interfaces baseline */

function wabtBinary() {
  const dir = process.env.WABT_BIN_DIRECTORY;
  const candidates = [dir && path.join(dir, "wasm-objdump"), "wasm-objdump"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      execFileSync(c, ["--version"], { stdio: "pipe" });
      return c;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// The parts of `wasm-objdump -x` that describe the boundary: what the module
// asks the loader for, what it offers back, and how much memory it may take.
function wasmInterface(bin, file) {
  const text = execFileSync(bin, ["-x", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const keep = [];
  let section = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^([A-Z][A-Za-z]+)\[/);
    if (head) section = head[1];
    if (!section) continue;
    if (section === "Import" || section === "Export" || section === "Memory") {
      const trimmed = line.trim();
      if (!trimmed || /^-+$/.test(trimmed)) continue;
      if (/^\w+\[/.test(trimmed)) { keep.push(trimmed); continue; }
      if (section === "Import" || section === "Export") keep.push(trimmed.replace(/\s+/g, " "));
      else if (section === "Memory") keep.push(trimmed.replace(/\s+/g, " "));
    }
  }
  return { sha256: sha256(file), interface: keep };
}

function checkInterfaces(manifest, results) {
  const bin = wabtBinary();
  if (!bin) {
    problems.push("--interfaces needs wabt's wasm-objdump (set WABT_BIN_DIRECTORY or put it on PATH)");
    return;
  }
  const mods = manifest.wasm_modules || [];
  if (!mods.length) {
    notes.push("no wasm_modules recorded yet — run --record --interfaces");
    return;
  }
  for (const mod of mods) {
    const abs = path.join(ext, mod.ext);
    if (!fs.existsSync(abs)) {
      problems.push(`${mod.ext} is missing`);
      continue;
    }
    const now = wasmInterface(bin, abs);
    if (record) {
      mod.sha256 = now.sha256;
      mod.interface = now.interface;
      console.log(`  rec  ${mod.ext} (${now.interface.length} boundary line(s))`);
      continue;
    }
    if (now.sha256 !== mod.sha256) {
      problems.push(`${mod.ext} changed (${now.sha256.slice(0, 12)}… vs recorded ${mod.sha256.slice(0, 12)}…) — re-record after reviewing the interface diff`);
      continue;
    }
    const drift = diffLines(mod.interface, now.interface);
    if (drift.length) problems.push(`${mod.ext} interface drifted:\n${drift.map((d) => `        ${d}`).join("\n")}`);
    else if (!quiet) console.log(`  ok   ${mod.ext} (${now.interface.length} boundary line(s), ${Math.round(fs.statSync(abs).size / 1024)} KiB)`);
  }
}

function diffLines(a, b) {
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) out.push(`- ${a[i] ?? "(absent)"}\n        + ${b[i] ?? "(absent)"}`);
  }
  return out;
}

/* ------------------------------------------------------------------- record */

function writeManifest(manifest, results) {
  for (const asset of manifest.assets) {
    const got = measure(asset);
    if (got.missing) {
      problems.push(`${asset.ext} is missing — cannot record`);
      continue;
    }
    asset.files = got.files;
    asset.digest = got.digest;
    if (results.has(asset.ext)) asset.patched_hunks = results.get(asset.ext);
  }
  manifest.recorded = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  wrote ${path.relative(root, manifestPath)}`);
}

/* --------------------------------------------------------------------- main */

const manifest = loadManifest();
const mode = [record && "--record", upstream && "--upstream", interfaces && "--interfaces"].filter(Boolean).join(" ");
console.log(`vendor check: ${manifest.assets.length} asset(s) from ${Object.keys(manifest.packages).length} package(s)${mode ? `, ${mode}` : ", offline"}`);

const results = new Map();
if (record) {
  if (upstream) checkUpstream(manifest, results);
  if (interfaces) checkInterfaces(manifest, results);
  writeManifest(manifest, results);
} else if (interfaces) {
  checkInterfaces(manifest, results);
} else if (upstream) {
  checkUpstream(manifest, results);
} else {
  const ok = checkDigests(manifest);
  console.log(`vendor check: ${ok}/${manifest.assets.length} recorded asset(s) match`);
}

for (const note of notes) console.log(`  note ${note}`);

if (problems.length) {
  console.error(`vendor check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  x ${p}`);
  if (!record) process.exit(1);
}
if (!record) {
  const pinned = Object.entries(manifest.packages).map(([n, p]) => `${n}@${p.version}`).join(", ");
  console.log(`vendor check: ok (${pinned})`);
}

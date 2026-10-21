#!/usr/bin/env node
// Tiny read-only static server for previewing the extension against sample
// markdown. Usage: node dev/serve.js [port]   (root is the repository)
//
// Static files come from the repository; /__md?path=/abs/file.md additionally serves any
// local markdown file, so the preview harness can render real documents.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2] || 8731);
const root = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    console.log(new Date().toISOString().slice(11, 19) + " " + req.method + " " + req.url);

    // /__md?path=<any absolute .md> — lets the preview harness render a real
    // document from anywhere on disk, not just the fixtures in test/.
    const external = url.pathname === "/__md" ? url.searchParams.get("path") : null;
    if (external) {
      if (!/\.(md|markdown)$/i.test(external) || !path.isAbsolute(external)) {
        res.writeHead(400).end("path must be an absolute .md file");
        return;
      }
      fs.readFile(external, (err, data) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(data);
      });
      return;
    }

    const target = path.join(root, decodeURIComponent(url.pathname));
    if (!target.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      // no-store: this server exists to show live edits, and a cached stylesheet
      // is indistinguishable from a fix that did not work.
      res.writeHead(200, {
        "content-type": TYPES[path.extname(target)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    fs.writeFileSync(path.join(__dirname, "server.pid"), String(process.pid));
    console.log("serving " + root + " on http://127.0.0.1:" + port + " (pid " + process.pid + ")");
  });

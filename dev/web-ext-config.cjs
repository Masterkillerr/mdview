// web-ext configuration for mdview.
// `dev/dev.sh` (or `npm run dev`) runs web-ext with this file: it
// loads extension/ as a temporary add-on in a throwaway Firefox profile,
// opens the sample document, and reloads the extension whenever mdview.js,
// mdview.css or manifest.json change.
//
// Top-level keys are web-ext's global options; `run` holds the hot-reload run
// options (web-ext only accepts options that exist for the sub-command).
"use strict";

const path = require("path");

module.exports = {
  // the Firefox build is the source of truth; build.sh mirrors it to Chrome
  sourceDir: path.resolve(__dirname, "..", "extension"),
  // the packaged xpi lives inside sourceDir but must never be part of the package
  ignoreFiles: ["mdview.xpi", "*.xpi", "*.zip", "node_modules"],
  run: {
    firefox: process.env.MDVIEW_FIREFOX || "firefox",
    // open the sample doc on launch; override with `-u <url>` on the CLI
    startUrl: ["file://" + path.resolve(__dirname, "test", "kitchen-sink.md")],
    reload: true,
    // a throwaway profile: your real Firefox profile is never touched
    keepProfileChanges: false,
  },
};

#!/usr/bin/env node
// Regenerates bookmarklet.html's draggable link from bookmarklet.js.
// Run after editing bookmarklet.js:  node build-bookmarklet.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "bookmarklet.js"), "utf8");
const start = src.indexOf("(function () {");
if (start < 0) throw new Error("bookmarklet.js: couldn't find the IIFE start");
const href = "javascript:" + encodeURIComponent(src.slice(start));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>todo — capture bookmarklet</title>
<style>
  body { background:#14161a; color:#e6e6e6; font:15px/1.5 -apple-system,system-ui,sans-serif; max-width:640px; margin:60px auto; padding:0 20px; }
  h1 { font-size:20px; }
  .btn { display:inline-block; background:#1c1f26; border:1px solid #2c313b; color:#6ea8fe; text-decoration:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:grab; }
  .btn:hover { border-color:#6ea8fe; }
  ol { padding-left:20px; }
  code { background:#1c1f26; padding:1px 5px; border-radius:4px; }
  .box { background:#1c1f26; border:1px solid #2c313b; border-radius:10px; padding:20px; margin:24px 0; text-align:center; }
</style>
</head>
<body>
<h1>Capture a job posting → todo app</h1>
<p>Drag this to your bookmarks bar:</p>
<div class="box">
  <a class="btn" href="${href}">📎 Capture job → todo</a>
</div>
<ol>
  <li>Make sure your bookmarks bar is visible (⌘⇧B in Chrome).</li>
  <li>Drag the button above onto the bookmarks bar.</li>
  <li>On any job posting page, click it. It reads the page’s structured job data
      (most ATS sites — Greenhouse, Workday, Lever, LinkedIn — embed this for
      Google Jobs), asks you to confirm the role and company, then adds
      <code>apply to &lt;company&gt; — &lt;role&gt;</code> to <code>todos.md</code>,
      tagged with your <code>captureTag</code> (if set), with the posting link, location,
      salary, and closing date (as <code>due:</code>) attached.</li>
  <li>If the page has no structured data, it falls back to asking for the role and
      company by hand.</li>
</ol>
<p>Requires the todo app running at <code>http://localhost:4444</code> — it always is,
via the launchd agent.</p>
</body>
</html>
`;

writeFileSync(join(HERE, "bookmarklet.html"), html);
console.log(`wrote bookmarklet.html (${html.length} bytes, href ${href.length} chars)`);

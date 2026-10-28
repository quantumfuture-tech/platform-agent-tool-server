"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set([".git", "node_modules", "coverage"]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push.apply(out, walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map(function (full) {
  return { path: path.relative(ROOT, full), text: fs.readFileSync(full, "utf8") };
});

test("仓库里没有密钥前缀、绝对路径或外部域名", function () {
  const findings = [];
  const secretPrefix = "s" + "k" + "-";
  const drivePath = /(?:^|[\s"'(])([A-Za-z]):[\\/]/;
  const homePath = /(?:^|[\s"'(])\/(?:home|Users)\//;
  const urlPattern = /https?:\/\/([^\s"'<>)]+)/g;

  for (const file of files) {
    if (file.text.indexOf(secretPrefix) !== -1) findings.push(file.path + ": 出现密钥前缀");
    if (drivePath.test(file.text)) findings.push(file.path + ": 出现盘符绝对路径");
    if (homePath.test(file.text)) findings.push(file.path + ": 出现用户目录绝对路径");

    urlPattern.lastIndex = 0;
    let match = null;
    while ((match = urlPattern.exec(file.text)) !== null) {
      const host = match[1].split("/")[0].split(":")[0].toLowerCase();
      if (["localhost", "127.0.0.1", "[::1]"].indexOf(host) === -1) {
        findings.push(file.path + ": 出现外部地址 " + host);
      }
    }
  }

  assert.deepEqual(findings, []);
});

test("所有数据都标注为合成数据", function () {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "engine", "rules", "demo-se-2024.json"), "utf8"));
  assert.match(rules.dataNote, /合成/);
  assert.equal(rules.school, "示例大学");
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "sample", "transcript.json"), "utf8"));
  assert.match(sample.dataNote, /合成/);
});

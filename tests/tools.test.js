"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server/index.js");

let server = null;
let base = "";

before(async function () {
  server = createServer();
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  base = "http://127.0.0.1:" + server.address().port;
});

after(async function () {
  if (!server) return;
  await new Promise(function (resolve) { server.close(resolve); });
});

async function post(name, body, options) {
  const opts = options || {};
  const hasBody = body !== undefined;
  const response = await fetch(base + "/api/tools/" + name, {
    method: opts.method || "POST",
    headers: { "Content-Type": "application/json" },
    body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, body: json, text: text };
}

async function get(pathname) {
  const response = await fetch(base + pathname);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, body: json };
}

function allPassed() {
  return ["GEN101", "GEN102", "FND201", "FND202", "MAJ301", "MAJ302", "PRA401", "PRA402"].map(function (courseId) {
    return { courseId: courseId, status: "passed", grade: 90 };
  });
}

test("GET /health 返回工具清单与培养方案", async function () {
  const result = await get("/health");
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.tools, ["plan", "progress", "risk", "report", "explain"]);
  assert.equal(result.body.programs.length, 1);
  assert.equal(result.body.programs[0].programId, "demo-se-2024");
});

test("GET /api/tools 列出五个工具", async function () {
  const result = await get("/api/tools");
  assert.equal(result.status, 200);
  assert.equal(result.body.tools.length, 5);
  for (const tool of result.body.tools) {
    assert.equal(tool.method, "POST");
    assert.equal(tool.path, "/api/tools/" + tool.name);
  }
});

test("plan 返回 8 门课与 160 毕业学分", async function () {
  const result = await post("plan", {});
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.tool, "plan");
  assert.equal(result.body.graduationCredits, 160);
  assert.equal(result.body.courseCount, 8);
  assert.equal(result.body.courses.length, 8);
  assert.equal(result.body.groupCount, 4);
  const sum = result.body.courses.reduce(function (total, course) { return total + course.credits; }, 0);
  assert.equal(sum, 160);
  assert.match(result.body.text, /毕业学分 160/);
});

test("progress 用内置 8 门课记录算出确定结果", async function () {
  const result = await post("progress", {});
  assert.equal(result.status, 200);
  assert.equal(result.body.earnedCredits, 122);
  assert.equal(result.body.requiredCredits, 160);
  assert.equal(result.body.gapCredits, 38);
  assert.equal(result.body.completionRatio, 0.7625);
  assert.deepEqual(result.body.counts, { passed: 5, failed: 0, in_progress: 1, not_started: 2 });
  const major = result.body.groups.find(function (group) { return group.id === "major"; });
  assert.equal(major.gapCredits, 22);
  assert.equal(major.complete, false);
  assert.match(result.body.text, /122 \/ 160/);
});

test("risk 把缺口映射成 medium（中）", async function () {
  const result = await post("risk", {});
  assert.equal(result.status, 200);
  assert.equal(result.body.level, "medium");
  assert.equal(result.body.label, "中");
  assert.equal(result.body.gapRatio, 0.2375);
  assert.equal(result.body.creditGapLevel, "medium");
  assert.equal(result.body.failedCoursesLevel, "low");
  assert.match(result.body.text, /风险档位：中/);
});

test("report 编号稳定，同一输入必得同一结果", async function () {
  const first = await post("report", {});
  const second = await post("report", {});
  assert.equal(first.status, 200);
  assert.equal(first.body.reportId, second.body.reportId);
  assert.match(first.body.reportId, /^[0-9a-f]{12}$/);
  assert.equal(first.body.graduationReady, false);
  assert.match(first.body.text, /报告编号/);
  assert.match(first.body.text, /缺口 38 学分/);
  assert.deepEqual(first.body, second.body);
});

test("explain 给出值、规则与输入", async function () {
  const result = await post("explain", { conclusion: "riskLevel" });
  assert.equal(result.status, 200);
  assert.equal(result.body.value, "medium");
  assert.equal(result.body.conclusion, "riskLevel");
  assert.equal(typeof result.body.rule, "string");
  assert.equal(result.body.inputs.creditGapLevel, "medium");
  assert.match(result.body.text, /规则：/);

  const group = await post("explain", { conclusion: "groupGap:major" });
  assert.equal(group.status, 200);
  assert.equal(group.body.value, 22);
});

test("自定义记录：全部通过则零缺口、低风险", async function () {
  const result = await post("risk", { transcript: allPassed() });
  assert.equal(result.status, 200);
  assert.equal(result.body.level, "low");
  assert.equal(result.body.gapCredits, 0);
  assert.equal(result.body.gapRatio, 0);

  const report = await post("report", { transcript: allPassed() });
  assert.equal(report.body.graduationReady, true);
  assert.match(report.body.text, /缺口 0 学分/);
});

test("自定义记录：空数组等于全部未开始", async function () {
  const result = await post("progress", { transcript: [] });
  assert.equal(result.status, 200);
  assert.equal(result.body.earnedCredits, 0);
  assert.equal(result.body.gapCredits, 160);
  assert.equal(result.body.counts.not_started, 8);
  const risk = await post("risk", { transcript: [] });
  assert.equal(risk.body.level, "high");
});

test("非法 transcript：不是数组", async function () {
  const result = await post("progress", { transcript: "GEN101" });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.field, "transcript");
  assert.equal(typeof result.body.error, "string");
});

test("非法 transcript：未知课程", async function () {
  const result = await post("progress", { transcript: [{ courseId: "XXX999", status: "passed" }] });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "unknown_course");
  assert.equal(result.body.field, "transcript[0].courseId");
});

test("非法 transcript：未知状态", async function () {
  const result = await post("progress", { transcript: [{ courseId: "GEN101", status: "done" }] });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_status");
});

test("非法 transcript：重复课程", async function () {
  const result = await post("progress", { transcript: [
    { courseId: "GEN101", status: "passed" },
    { courseId: "GEN101", status: "failed" },
  ] });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "duplicate_course");
});

test("非法 transcript：成绩超范围", async function () {
  const result = await post("progress", { transcript: [{ courseId: "GEN101", status: "passed", grade: 101 }] });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_grade");
});

test("非法 programId", async function () {
  const unknown = await post("plan", { programId: "missing" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "unknown_program");

  const wrongType = await post("plan", { programId: 42 });
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.body.field, "programId");
});

test("explain 缺 conclusion 或不认识 conclusion 都回 400", async function () {
  const missing = await post("explain", {});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "missing_conclusion");

  const unknown = await post("explain", { conclusion: "gpa" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "unknown_conclusion");
  assert.match(unknown.body.error, /riskLevel/);
});

test("请求体不是合法 JSON", async function () {
  const result = await post("plan", "{oops");
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_json");
});

test("请求体必须是 JSON 对象", async function () {
  const result = await post("plan", "[1,2,3]");
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_body");
});

test("未知工具返回 404 与可用工具清单", async function () {
  const result = await post("nope", {});
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "unknown_tool");
  assert.equal(result.body.tools.length, 5);
});

test("工具路径只接受 POST", async function () {
  const response = await fetch(base + "/api/tools/plan");
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.code, "method_not_allowed");
  assert.equal(response.headers.get("allow"), "POST");
});

test("未知路径返回 404", async function () {
  const result = await get("/nope");
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "not_found");
});

test("尾斜杠等价于无尾斜杠", async function () {
  const result = await post("plan/", {});
  assert.equal(result.status, 200);
  assert.equal(result.body.tool, "plan");
});

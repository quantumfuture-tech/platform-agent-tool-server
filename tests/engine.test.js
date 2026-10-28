"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../engine/index.js");

const program = engine.getProgram("demo-se-2024");

function passed(codes) {
  return codes.map(function (courseId) { return { courseId: courseId, status: "passed", grade: 90 }; });
}

test("合成培养方案自洽：8 门课、160 学分、4 个课程组", function () {
  assert.equal(program.courses.length, 8);
  assert.equal(program.graduationCredits, 160);
  assert.equal(program.groups.length, 4);
  const courseTotal = program.courses.reduce(function (total, course) { return total + course.credits; }, 0);
  assert.equal(courseTotal, 160);
  const groupTotal = program.groups.reduce(function (total, group) { return total + group.requiredCredits; }, 0);
  assert.equal(groupTotal, 160);
  const codes = new Set(program.courses.map(function (course) { return course.code; }));
  assert.equal(codes.size, 8);
});

test("同一份规则加同一份记录，结果深度相等", function () {
  const transcript = passed(["GEN101", "FND201", "MAJ301"]);
  const first = engine.evaluate(program, transcript);
  const second = engine.evaluate(program, transcript);
  assert.deepEqual(first, second);
});

test("缺口比例 0.15 是 low 的边界（含）", function () {
  const transcript = passed(["GEN102", "FND201", "FND202", "MAJ301", "MAJ302", "PRA401", "PRA402"]);
  const evaluation = engine.evaluate(program, transcript);
  assert.equal(evaluation.earnedCredits, 136);
  assert.equal(evaluation.gapCredits, 24);
  assert.equal(evaluation.risk.gapRatio, 0.15);
  assert.equal(evaluation.risk.level, "low");
});

test("缺口比例 0.35 是 medium 的边界（含）", function () {
  const transcript = passed(["GEN101", "GEN102", "FND201", "MAJ301", "PRA401"]);
  const evaluation = engine.evaluate(program, transcript);
  assert.equal(evaluation.earnedCredits, 104);
  assert.equal(evaluation.gapCredits, 56);
  assert.equal(evaluation.risk.gapRatio, 0.35);
  assert.equal(evaluation.risk.level, "medium");
});

test("没有记录时缺口 160，档位 high", function () {
  const evaluation = engine.evaluate(program, []);
  assert.equal(evaluation.earnedCredits, 0);
  assert.equal(evaluation.gapRatio, 1);
  assert.equal(evaluation.risk.level, "high");
  assert.equal(evaluation.graduationReady, false);
});

test("未通过课程会单独抬高档位", function () {
  const transcript = program.courses.filter(function (course) { return course.code !== "MAJ302"; })
    .map(function (course) { return { courseId: course.code, status: "passed", grade: 90 }; });
  transcript.push({ courseId: "MAJ302", status: "failed", grade: 55 });
  const evaluation = engine.evaluate(program, transcript);
  assert.equal(evaluation.gapCredits, 22);
  assert.equal(evaluation.risk.creditGapLevel, "low");
  assert.equal(evaluation.risk.failedCoursesLevel, "medium");
  assert.equal(evaluation.risk.level, "medium");
});

test("每条结论都能被 explain 找到", function () {
  const ids = engine.conclusionIds(program);
  for (const id of ["earnedCredits", "gapCredits", "gapRatio", "failedCourses", "riskLevel", "graduationReady", "groupGap:major"]) {
    assert.ok(ids.indexOf(id) !== -1, "缺结论：" + id);
    assert.ok(engine.explain(program, [], id));
  }
  assert.equal(engine.explain(program, [], "nope"), null);
});

test("报告编号只由培养方案与记录决定", function () {
  const first = engine.evaluate(program, passed(["GEN101"]));
  const second = engine.evaluate(program, passed(["GEN101"]));
  const other = engine.evaluate(program, passed(["GEN102"]));
  assert.equal(first.reportId, second.reportId);
  assert.notEqual(first.reportId, other.reportId);
});

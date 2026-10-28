"use strict";

/**
 * 极简规则引擎。
 *
 * 一条纪律：数字全在这里算，调用方（HTTP 层、模型）只读取结果。
 * 输入 = 培养方案（规则） + 成绩记录（事实）；
 * 输出 = 评估结果 + 一条可解释的事实链。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RULES_DIR = path.join(__dirname, "rules");
const STATUSES = ["passed", "failed", "in_progress", "not_started"];

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function assertRule(condition, message) {
  if (!condition) throw new Error(message);
}

function validateProgram(program, source) {
  const where = source || "program";
  assertRule(program && typeof program === "object" && !Array.isArray(program), where + ": 规则必须是对象");
  assertRule(typeof program.programId === "string" && program.programId.length > 0, where + ": 缺 programId");
  assertRule(Number.isFinite(program.graduationCredits) && program.graduationCredits > 0, where + ": graduationCredits 必须是正数");
  assertRule(Array.isArray(program.groups) && program.groups.length > 0, where + ": groups 不能为空");
  assertRule(Array.isArray(program.courses) && program.courses.length > 0, where + ": courses 不能为空");

  const groupIds = new Set();
  for (const group of program.groups) {
    assertRule(group && typeof group.id === "string" && group.id.length > 0, where + ": 课程组缺 id");
    assertRule(!groupIds.has(group.id), where + ": 课程组 id 重复：" + group.id);
    groupIds.add(group.id);
    assertRule(Number.isFinite(group.requiredCredits) && group.requiredCredits > 0, where + ": 课程组 " + group.id + " 的 requiredCredits 必须是正数");
  }

  const codes = new Set();
  let total = 0;
  for (const course of program.courses) {
    assertRule(typeof course.code === "string" && course.code.length > 0, where + ": 课程缺 code");
    assertRule(!codes.has(course.code), where + ": 课程 code 重复：" + course.code);
    codes.add(course.code);
    assertRule(Number.isFinite(course.credits) && course.credits > 0, where + ": 课程 " + course.code + " 的 credits 必须是正数");
    assertRule(groupIds.has(course.group), where + ": 课程 " + course.code + " 指向未知课程组：" + course.group);
    total += course.credits;
  }
  assertRule(total === program.graduationCredits, where + ": 课程学分合计 " + total + " 不等于毕业学分 " + program.graduationCredits);

  const risk = program.risk;
  assertRule(risk && Array.isArray(risk.order) && risk.order.length > 0, where + ": 缺 risk.order");
  assertRule(Array.isArray(risk.creditGap) && risk.creditGap.length > 0, where + ": 缺 risk.creditGap");
  assertRule(Array.isArray(risk.failedCourses) && risk.failedCourses.length > 0, where + ": 缺 risk.failedCourses");
}

// --- 规则加载开始 ---
// 第一版把规则内联在代码里，随后外置为 engine/rules/*.json。
const INLINE_PROGRAM = {
  "programId": "demo-se-2024",
  "label": "示例大学 · 软件工程 · 2024 培养方案（合成数据）",
  "school": "示例大学",
  "major": "软件工程",
  "year": 2024,
  "dataNote": "本文件全部内容为合成示例，不对应任何真实学校、专业或学生。",
  "graduationCredits": 160,
  "groups": [
    {
      "id": "general",
      "label": "通识必修",
      "requiredCredits": 48
    },
    {
      "id": "foundation",
      "label": "学科基础",
      "requiredCredits": 52
    },
    {
      "id": "major",
      "label": "专业核心",
      "requiredCredits": 44
    },
    {
      "id": "practice",
      "label": "实践环节",
      "requiredCredits": 16
    }
  ],
  "statuses": {
    "passed": "已通过",
    "failed": "未通过",
    "in_progress": "进行中",
    "not_started": "未开始"
  },
  "courses": [
    {
      "code": "GEN101",
      "title": "大学写作与表达",
      "credits": 24,
      "group": "general",
      "term": "第 1 学期"
    },
    {
      "code": "GEN102",
      "title": "数学与逻辑基础",
      "credits": 24,
      "group": "general",
      "term": "第 1 学期"
    },
    {
      "code": "FND201",
      "title": "程序设计基础",
      "credits": 26,
      "group": "foundation",
      "term": "第 2 学期"
    },
    {
      "code": "FND202",
      "title": "数据结构与算法",
      "credits": 26,
      "group": "foundation",
      "term": "第 3 学期"
    },
    {
      "code": "MAJ301",
      "title": "软件工程方法",
      "credits": 22,
      "group": "major",
      "term": "第 4 学期"
    },
    {
      "code": "MAJ302",
      "title": "数据库系统",
      "credits": 22,
      "group": "major",
      "term": "第 5 学期"
    },
    {
      "code": "PRA401",
      "title": "工程实践项目",
      "credits": 8,
      "group": "practice",
      "term": "第 6 学期"
    },
    {
      "code": "PRA402",
      "title": "毕业设计",
      "credits": 8,
      "group": "practice",
      "term": "第 8 学期"
    }
  ],
  "risk": {
    "levels": {
      "low": "低",
      "medium": "中",
      "high": "高"
    },
    "order": [
      "low",
      "medium",
      "high"
    ],
    "creditGap": [
      {
        "level": "low",
        "maxGapRatio": 0.15,
        "note": "缺口不超过毕业学分的 15%"
      },
      {
        "level": "medium",
        "maxGapRatio": 0.35,
        "note": "缺口不超过毕业学分的 35%"
      },
      {
        "level": "high",
        "maxGapRatio": 1,
        "note": "缺口超过毕业学分的 35%"
      }
    ],
    "failedCourses": [
      {
        "level": "low",
        "maxFailed": 0,
        "note": "没有未通过课程"
      },
      {
        "level": "medium",
        "maxFailed": 2,
        "note": "未通过课程 1 到 2 门"
      },
      {
        "level": "high",
        "maxFailed": 999,
        "note": "未通过课程 3 门及以上"
      }
    ]
  }
};
validateProgram(INLINE_PROGRAM, "inline");
const PROGRAMS = new Map([[INLINE_PROGRAM.programId, INLINE_PROGRAM]]);
const DEFAULT_PROGRAM_ID = INLINE_PROGRAM.programId;
// --- 规则加载结束 ---

function listPrograms() {
  return Array.from(PROGRAMS.values()).map(function (program) {
    return {
      programId: program.programId,
      label: program.label,
      school: program.school,
      major: program.major,
      year: program.year,
      graduationCredits: program.graduationCredits,
      courseCount: program.courses.length,
    };
  });
}

function getProgram(programId) {
  if (programId === undefined || programId === null) return PROGRAMS.get(DEFAULT_PROGRAM_ID);
  return PROGRAMS.get(String(programId)) || null;
}

function pickBand(bands, limitKey, value) {
  for (const band of bands) {
    if (value <= band[limitKey]) return band;
  }
  return bands[bands.length - 1];
}

function highestLevel(order, first, second) {
  if (order.indexOf(first) >= order.indexOf(second)) return first;
  return second;
}

function makeFact(id, label, value, unit, rule, inputs) {
  return { id: id, label: label, value: value, unit: unit, rule: rule, inputs: inputs };
}

/**
 * 跑一遍规则：课程状态 -> 学分 -> 分组缺口 -> 风险档位。
 * 同一份规则 + 同一份记录 => 逐字节相同的输出（含 reportId）。
 */
function evaluate(program, transcript) {
  const entries = new Map();
  for (const item of transcript || []) entries.set(item.courseId, item);

  const courses = program.courses.map(function (course) {
    const entry = entries.get(course.code);
    const status = entry ? entry.status : "not_started";
    const grade = entry && entry.grade !== null && entry.grade !== undefined ? entry.grade : null;
    return {
      code: course.code,
      title: course.title,
      credits: course.credits,
      group: course.group,
      term: course.term,
      status: status,
      statusLabel: program.statuses[status] || status,
      grade: grade,
      earnedCredits: status === "passed" ? course.credits : 0,
    };
  });

  const counts = { passed: 0, failed: 0, in_progress: 0, not_started: 0 };
  for (const course of courses) counts[course.status] += 1;

  let earnedCredits = 0;
  for (const course of courses) earnedCredits += course.earnedCredits;
  const requiredCredits = program.graduationCredits;
  const gapCredits = Math.max(0, requiredCredits - earnedCredits);
  const completionRatio = requiredCredits > 0 ? round(earnedCredits / requiredCredits, 4) : 0;
  const gapRatio = requiredCredits > 0 ? round(gapCredits / requiredCredits, 4) : 0;

  const groups = program.groups.map(function (group) {
    const members = courses.filter(function (course) { return course.group === group.id; });
    let earned = 0;
    for (const course of members) earned += course.earnedCredits;
    const gap = Math.max(0, group.requiredCredits - earned);
    return {
      id: group.id,
      label: group.label,
      requiredCredits: group.requiredCredits,
      earnedCredits: earned,
      gapCredits: gap,
      complete: gap === 0,
      courseCount: members.length,
    };
  });

  const pendingCourses = courses.filter(function (course) { return course.status !== "passed"; });
  const failedCourses = courses.filter(function (course) { return course.status === "failed"; }).map(function (course) { return course.code; });

  const creditBand = pickBand(program.risk.creditGap, "maxGapRatio", gapRatio);
  const failureBand = pickBand(program.risk.failedCourses, "maxFailed", counts.failed);
  const level = highestLevel(program.risk.order, creditBand.level, failureBand.level);

  const risk = {
    level: level,
    label: program.risk.levels[level] || level,
    gapRatio: gapRatio,
    gapCredits: gapCredits,
    failedCourses: counts.failed,
    creditGapLevel: creditBand.level,
    failedCoursesLevel: failureBand.level,
    factors: [
      { id: "creditGap", label: "学分缺口", level: creditBand.level, note: creditBand.note },
      { id: "failedCourses", label: "未通过课程", level: failureBand.level, note: failureBand.note },
    ],
  };

  const passedCodes = courses.filter(function (course) { return course.status === "passed"; }).map(function (course) { return course.code; });
  const earnedInputs = {};
  for (const course of courses) {
    if (course.status === "passed") earnedInputs[course.code] = course.credits;
  }

  const facts = [];
  facts.push(makeFact(
    "earnedCredits", "已获学分", earnedCredits, "学分",
    "已获学分 = 状态为 passed 的课程学分之和",
    earnedInputs
  ));
  facts.push(makeFact(
    "gapCredits", "毕业学分缺口", gapCredits, "学分",
    "缺口 = 毕业学分 - 已获学分",
    { requiredCredits: requiredCredits, earnedCredits: earnedCredits }
  ));
  facts.push(makeFact(
    "gapRatio", "缺口比例", gapRatio, "",
    "缺口比例 = 缺口 / 毕业学分",
    { gapCredits: gapCredits, requiredCredits: requiredCredits }
  ));
  facts.push(makeFact(
    "failedCourses", "未通过课程数", counts.failed, "门",
    "未通过课程数 = 状态为 failed 的课程数",
    { failedCourseCodes: failedCourses.join(",") || "（无）" }
  ));
  facts.push(makeFact(
    "riskByGap", "学分缺口档位", creditBand.level, "",
    "缺口比例 " + gapRatio + "；" + creditBand.note + " => " + creditBand.level,
    { gapRatio: gapRatio }
  ));
  facts.push(makeFact(
    "riskByFailed", "未通过课程档位", failureBand.level, "",
    "未通过课程数 " + counts.failed + "；" + failureBand.note + " => " + failureBand.level,
    { failedCourses: counts.failed }
  ));
  facts.push(makeFact(
    "riskLevel", "风险档位", level, "",
    "riskLevel = 两个因子中较高的档位（" + program.risk.order.join(" < ") + "）",
    { creditGapLevel: creditBand.level, failedCoursesLevel: failureBand.level }
  ));
  facts.push(makeFact(
    "graduationReady", "毕业资格预判", gapCredits === 0, "",
    "毕业资格预判 = 学分缺口为 0（只做学分预判，不含其它毕业条件）",
    { gapCredits: gapCredits }
  ));
  for (const group of groups) {
    facts.push(makeFact(
      "groupGap:" + group.id, group.label + "缺口", group.gapCredits, "学分",
      group.label + "缺口 = max(0, 要求学分 - 已获学分)",
      { requiredCredits: group.requiredCredits, earnedCredits: group.earnedCredits }
    ));
  }

  const signature = program.programId + "|" + courses.map(function (course) {
    return course.code + ":" + course.status + ":" + (course.grade === null ? "" : course.grade);
  }).join(",");
  const reportId = crypto.createHash("sha1").update(signature).digest("hex").slice(0, 12);

  return {
    program: program,
    programId: program.programId,
    label: program.label,
    school: program.school,
    major: program.major,
    year: program.year,
    graduationCredits: requiredCredits,
    courses: courses,
    groups: groups,
    counts: counts,
    earnedCredits: earnedCredits,
    requiredCredits: requiredCredits,
    gapCredits: gapCredits,
    gapRatio: gapRatio,
    completionRatio: completionRatio,
    pendingCourses: pendingCourses,
    failedCourseCodes: failedCourses,
    risk: risk,
    graduationReady: gapCredits === 0,
    facts: facts,
    reportId: reportId,
  };
}

function evaluateById(programId, transcript) {
  const program = getProgram(programId);
  if (!program) throw new Error("没有这个培养方案：" + programId);
  return evaluate(program, transcript);
}

function conclusionIds(program) {
  const evaluation = evaluate(program, []);
  return evaluation.facts.map(function (fact) { return fact.id; });
}

function explain(program, transcript, conclusion) {
  const evaluation = evaluate(program, transcript);
  const wanted = String(conclusion || "");
  let found = null;
  for (const fact of evaluation.facts) {
    if (fact.id === wanted) { found = fact; break; }
  }
  if (!found) return null;
  return { evaluation: evaluation, fact: found };
}

module.exports = {
  STATUSES: STATUSES,
  validateProgram: validateProgram,
  listPrograms: listPrograms,
  getProgram: getProgram,
  evaluate: evaluate,
  evaluateById: evaluateById,
  explain: explain,
  conclusionIds: conclusionIds,
};

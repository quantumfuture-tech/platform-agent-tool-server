"use strict";

/**
 * 五个工具：契约、入参校验、响应形状。
 *
 * 这个文件只做两件事：把请求体变成引擎能吃的输入；把引擎结果变成稳定的 JSON。
 * 任何计算都不在这里发生 —— 想改口径，去改 engine/。
 */

const engine = require("../engine");
const render = require("../engine/render");
const SAMPLE = {
  "recordId": "sample-record-001",
  "programId": "demo-se-2024",
  "dataNote": "合成记录，不对应任何真实学生。",
  "transcript": [
    {
      "courseId": "GEN101",
      "status": "passed",
      "grade": 88
    },
    {
      "courseId": "GEN102",
      "status": "passed",
      "grade": 76
    },
    {
      "courseId": "FND201",
      "status": "passed",
      "grade": 92
    },
    {
      "courseId": "FND202",
      "status": "passed",
      "grade": 64
    },
    {
      "courseId": "MAJ301",
      "status": "passed",
      "grade": 81
    },
    {
      "courseId": "MAJ302",
      "status": "in_progress"
    },
    {
      "courseId": "PRA401",
      "status": "not_started"
    },
    {
      "courseId": "PRA402",
      "status": "not_started"
    }
  ]
};

const STATUS_SET = new Set(engine.STATUSES);
const MAX_BODY_ITEMS = 100;

class ToolError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "ToolError";
    const opts = options || {};
    this.code = opts.code || "invalid_argument";
    this.field = opts.field || null;
    this.status = opts.status || 400;
    this.extra = opts.extra || null;
  }
}

const TOOLS = [
  {
    name: "plan",
    summary: "返回培养方案结构：课程、课程组、毕业学分要求。",
    input: "programId（可选）",
  },
  {
    name: "progress",
    summary: "用一份成绩记录算学分进度与分组缺口。",
    input: "programId（可选）、transcript（可选，不传则用内置合成记录）",
  },
  {
    name: "risk",
    summary: "把进度映射成风险档位，并给出两个因子的档位。",
    input: "programId（可选）、transcript（可选）",
  },
  {
    name: "report",
    summary: "生成一份可粘贴的文字报告，编号由输入决定。",
    input: "programId（可选）、transcript（可选）",
  },
  {
    name: "explain",
    summary: "解释一条结论：值、规则、输入分别是什么。",
    input: "conclusion（必填）、programId（可选）、transcript（可选）",
  },
];

function listTools() {
  return TOOLS.map(function (tool) {
    return {
      name: tool.name,
      method: "POST",
      path: "/api/tools/" + tool.name,
      summary: tool.summary,
      input: tool.input,
    };
  });
}

function names() {
  return TOOLS.map(function (tool) { return tool.name; });
}

function has(name) {
  return names().indexOf(name) !== -1;
}

function resolveProgram(input) {
  const raw = input.programId;
  if (raw === undefined) return engine.getProgram();
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ToolError("programId 必须是非空字符串", { field: "programId" });
  }
  const program = engine.getProgram(raw.trim());
  if (!program) {
    const available = engine.listPrograms().map(function (item) { return item.programId; });
    throw new ToolError("没有这个培养方案：" + raw + "；可用：" + available.join("、"), {
      code: "unknown_program",
      field: "programId",
    });
  }
  return program;
}

function transcriptSource(input) {
  return Object.prototype.hasOwnProperty.call(input, "transcript") ? "request" : "bundled";
}

function resolveTranscript(program, input) {
  const source = transcriptSource(input);
  const raw = source === "request" ? input.transcript : SAMPLE.transcript;
  if (!Array.isArray(raw)) {
    throw new ToolError("transcript 必须是数组；不传则使用内置的合成记录", { field: "transcript" });
  }
  if (raw.length > MAX_BODY_ITEMS) {
    throw new ToolError("transcript 最多 " + MAX_BODY_ITEMS + " 条", { field: "transcript" });
  }

  const known = new Set(program.courses.map(function (course) { return course.code; }));
  const seen = new Set();
  const normalized = [];

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const at = "transcript[" + index + "]";
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ToolError(at + " 必须是对象", { field: at });
    }
    if (typeof item.courseId !== "string" || item.courseId.length === 0) {
      throw new ToolError(at + ".courseId 必须是非空字符串", { field: at + ".courseId" });
    }
    if (!known.has(item.courseId)) {
      throw new ToolError(at + ".courseId 不在培养方案里：" + item.courseId + "；可用：" + Array.from(known).join("、"), {
        code: "unknown_course",
        field: at + ".courseId",
      });
    }
    if (seen.has(item.courseId)) {
      throw new ToolError(at + ".courseId 重复：" + item.courseId, { field: at + ".courseId", code: "duplicate_course" });
    }
    seen.add(item.courseId);

    if (typeof item.status !== "string" || !STATUS_SET.has(item.status)) {
      throw new ToolError(at + ".status 必须是 passed / failed / in_progress / not_started 之一", {
        code: "invalid_status",
        field: at + ".status",
      });
    }

    let grade = null;
    if (item.grade !== undefined && item.grade !== null) {
      if (typeof item.grade !== "number" || !Number.isFinite(item.grade) || item.grade < 0 || item.grade > 100) {
        throw new ToolError(at + ".grade 必须是 0 到 100 之间的数字", { code: "invalid_grade", field: at + ".grade" });
      }
      grade = item.grade;
    }

    normalized.push({ courseId: item.courseId, status: item.status, grade: grade });
  }

  return { source: source, transcript: normalized };
}

function programSummary(program) {
  return {
    programId: program.programId,
    programLabel: program.label,
    school: program.school,
    major: program.major,
    year: program.year,
    graduationCredits: program.graduationCredits,
  };
}

function riskRuleText(program) {
  const gapBands = program.risk.creditGap.map(function (band) {
    return band.note + " => " + band.level;
  });
  const failedBands = program.risk.failedCourses.map(function (band) {
    return band.note + " => " + band.level;
  });
  return "学分缺口：" + gapBands.join("；") + "。未通过课程：" + failedBands.join("；") + "。取两者中较高档。";
}

function plan(input) {
  const program = resolveProgram(input);
  const courses = program.courses.map(function (course) {
    return {
      code: course.code,
      title: course.title,
      credits: course.credits,
      group: course.group,
      term: course.term,
    };
  });
  const groups = program.groups.map(function (group) {
    const members = program.courses.filter(function (course) { return course.group === group.id; });
    return {
      id: group.id,
      label: group.label,
      requiredCredits: group.requiredCredits,
      courseCount: members.length,
      courses: members.map(function (course) { return course.code; }),
    };
  });
  return Object.assign({ ok: true, tool: "plan" }, programSummary(program), {
    courseCount: courses.length,
    groupCount: groups.length,
    courses: courses,
    groups: groups,
    text: render.planText(program),
  });
}

function progress(input) {
  const program = resolveProgram(input);
  const resolved = resolveTranscript(program, input);
  const evaluation = engine.evaluate(program, resolved.transcript);
  return Object.assign({ ok: true, tool: "progress" }, programSummary(program), {
    source: resolved.source,
    recordId: resolved.source === "bundled" ? SAMPLE.recordId : null,
    earnedCredits: evaluation.earnedCredits,
    requiredCredits: evaluation.requiredCredits,
    gapCredits: evaluation.gapCredits,
    completionRatio: evaluation.completionRatio,
    counts: evaluation.counts,
    groups: evaluation.groups.map(function (group) {
      return {
        id: group.id,
        label: group.label,
        requiredCredits: group.requiredCredits,
        earnedCredits: group.earnedCredits,
        gapCredits: group.gapCredits,
        complete: group.complete,
      };
    }),
    pendingCourses: evaluation.pendingCourses.map(function (course) {
      return { code: course.code, title: course.title, status: course.status, credits: course.credits };
    }),
    text: render.progressText(evaluation),
  });
}

function risk(input) {
  const program = resolveProgram(input);
  const resolved = resolveTranscript(program, input);
  const evaluation = engine.evaluate(program, resolved.transcript);
  return Object.assign({ ok: true, tool: "risk" }, programSummary(program), {
    source: resolved.source,
    level: evaluation.risk.level,
    label: evaluation.risk.label,
    gapCredits: evaluation.gapCredits,
    gapRatio: evaluation.risk.gapRatio,
    failedCourses: evaluation.risk.failedCourses,
    creditGapLevel: evaluation.risk.creditGapLevel,
    failedCoursesLevel: evaluation.risk.failedCoursesLevel,
    ruleText: riskRuleText(program),
    text: render.riskText(evaluation),
  });
}

function report(input) {
  const program = resolveProgram(input);
  const resolved = resolveTranscript(program, input);
  const evaluation = engine.evaluate(program, resolved.transcript);
  return Object.assign({ ok: true, tool: "report" }, programSummary(program), {
    source: resolved.source,
    reportId: evaluation.reportId,
    title: "学分与风险报告",
    earnedCredits: evaluation.earnedCredits,
    requiredCredits: evaluation.requiredCredits,
    gapCredits: evaluation.gapCredits,
    riskLevel: evaluation.risk.level,
    graduationReady: evaluation.graduationReady,
    text: render.reportText(evaluation),
  });
}

function explain(input) {
  const program = resolveProgram(input);
  if (typeof input.conclusion !== "string" || input.conclusion.length === 0) {
    throw new ToolError("缺 conclusion：要解释哪一条结论", { field: "conclusion", code: "missing_conclusion" });
  }
  const resolved = resolveTranscript(program, input);
  const result = engine.explain(program, resolved.transcript, input.conclusion);
  if (!result) {
    const supported = engine.conclusionIds(program);
    throw new ToolError("不认识的 conclusion：" + input.conclusion + "；可用：" + supported.join("、"), {
      code: "unknown_conclusion",
      field: "conclusion",
    });
  }
  const fact = result.fact;
  return Object.assign({ ok: true, tool: "explain" }, programSummary(program), {
    source: resolved.source,
    conclusion: fact.id,
    label: fact.label,
    value: fact.value,
    unit: fact.unit,
    rule: fact.rule,
    inputs: fact.inputs,
    text: render.explainText(result.evaluation, fact),
  });
}

const HANDLERS = { plan: plan, progress: progress, risk: risk, report: report, explain: explain };

function run(name, input) {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new ToolError("没有这个工具：" + name, { status: 404, code: "unknown_tool" });
  }
  return handler(input);
}

module.exports = {
  ToolError: ToolError,
  listTools: listTools,
  names: names,
  has: has,
  run: run,
};

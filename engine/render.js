"use strict";

/**
 * 把引擎算好的结果渲染成可直接转述的文字。
 * 文字里的每个数字都来自评估结果，这里不做任何二次计算。
 */

function percent(ratio) {
  const value = Math.round(ratio * 1000) / 10;
  return value.toFixed(1) + "%";
}

function planText(program) {
  const lines = [];
  lines.push(program.label);
  lines.push("毕业学分 " + program.graduationCredits + "；共 " + program.courses.length + " 门课，分 " + program.groups.length + " 个课程组。");
  for (const group of program.groups) {
    const codes = program.courses.filter(function (course) { return course.group === group.id; }).map(function (course) { return course.code; });
    lines.push("- " + group.label + "：" + group.requiredCredits + " 学分，" + codes.length + " 门（" + codes.join("、") + "）");
  }
  lines.push("培养方案 id：" + program.programId + "（合成数据，不对应任何真实学校或学生）");
  return lines.join("\n");
}

function progressText(evaluation) {
  const lines = [];
  lines.push("学分进度：" + evaluation.earnedCredits + " / " + evaluation.requiredCredits + "（" + percent(evaluation.completionRatio) + "），缺口 " + evaluation.gapCredits + " 学分。");
  lines.push("课程：已通过 " + evaluation.counts.passed + "，未通过 " + evaluation.counts.failed + "，进行中 " + evaluation.counts.in_progress + "，未开始 " + evaluation.counts.not_started + "。");
  lines.push("分组：");
  for (const group of evaluation.groups) {
    lines.push("- " + group.label + "：" + group.earnedCredits + " / " + group.requiredCredits + (group.complete ? "（已满）" : "（缺 " + group.gapCredits + "）"));
  }
  if (evaluation.pendingCourses.length > 0) {
    const pending = evaluation.pendingCourses.map(function (course) { return course.code + "（" + course.statusLabel + "）"; });
    lines.push("待完成：" + pending.join("、"));
  }
  return lines.join("\n");
}

function riskText(evaluation) {
  const lines = [];
  lines.push("风险档位：" + evaluation.risk.label + "（" + evaluation.risk.level + "）。");
  lines.push("学分缺口 " + evaluation.gapCredits + "（" + percent(evaluation.risk.gapRatio) + "），未通过 " + evaluation.risk.failedCourses + " 门。");
  const factors = evaluation.risk.factors.map(function (factor) { return factor.label + " → " + factor.level; });
  lines.push("因子：" + factors.join("；") + "；取较高者。");
  return lines.join("\n");
}

function reportText(evaluation) {
  const lines = [];
  lines.push("# 学分与风险报告（合成数据）");
  lines.push("");
  lines.push("培养方案：" + evaluation.label);
  lines.push("报告编号：" + evaluation.reportId);
  lines.push("");
  lines.push("## 学分进度");
  lines.push("- 已获 " + evaluation.earnedCredits + " / " + evaluation.requiredCredits + " 学分（" + percent(evaluation.completionRatio) + "）");
  lines.push("- 缺口 " + evaluation.gapCredits + " 学分");
  lines.push("- 已通过 " + evaluation.counts.passed + " 门，未通过 " + evaluation.counts.failed + " 门，进行中 " + evaluation.counts.in_progress + " 门，未开始 " + evaluation.counts.not_started + " 门");
  lines.push("");
  lines.push("## 分组缺口");
  const unfinished = evaluation.groups.filter(function (group) { return !group.complete; });
  if (unfinished.length === 0) {
    lines.push("- 各课程组均已满");
  } else {
    for (const group of unfinished) {
      lines.push("- " + group.label + "：缺 " + group.gapCredits + " 学分（" + group.earnedCredits + " / " + group.requiredCredits + "）");
    }
  }
  lines.push("");
  lines.push("## 风险档位");
  lines.push("- " + evaluation.risk.label + "（" + evaluation.risk.level + "）");
  for (const factor of evaluation.risk.factors) {
    lines.push("- " + factor.label + "：" + factor.level + "（" + factor.note + "）");
  }
  lines.push("");
  lines.push("## 结论");
  lines.push("按当前记录，毕业学分缺口 " + evaluation.gapCredits + " 学分；风险档位 " + evaluation.risk.label + "（" + evaluation.risk.level + "）。");
  lines.push("以上数字由规则引擎按同一份规则与同一份记录计算，模型只负责转述。");
  return lines.join("\n");
}

function explainText(evaluation, fact) {
  const lines = [];
  const unit = fact.unit ? " " + fact.unit : "";
  lines.push(fact.label + "：" + String(fact.value) + unit);
  lines.push("规则：" + fact.rule);
  const keys = Object.keys(fact.inputs);
  if (keys.length === 0) {
    lines.push("输入：无");
  } else {
    const parts = keys.map(function (key) { return key + "=" + String(fact.inputs[key]); });
    lines.push("输入：" + parts.join("；"));
  }
  return lines.join("\n");
}

module.exports = {
  percent: percent,
  planText: planText,
  progressText: progressText,
  riskText: riskText,
  reportText: reportText,
  explainText: explainText,
};

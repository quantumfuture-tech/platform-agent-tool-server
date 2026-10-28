# 五个工具各解决什么

五个工具都走 POST + JSON，路径是 /api/tools/<name>。名字是中性词：不绑定具体业务领域，换一个业务也能套用同一套骨架。

| 工具 | 解决的问题 | 输入 | 输出 |
| --- | --- | --- | --- |
| plan | 方案长什么样 | programId（可选） | 课程、课程组、毕业学分、text |
| progress | 现在修到哪了 | transcript（可选） | 已获/缺口/完成率、分组缺口、待完成课程 |
| risk | 处在什么档位 | transcript（可选） | level、两个因子的档位、规则说明 |
| report | 怎么整段说清楚 | transcript（可选） | reportId、结构化字段、整段文字 |
| explain | 这条结论怎么来的 | conclusion（必填）+ transcript | value、rule、inputs |

## plan

回答「这个专业毕业要多少学分、有哪些课、怎么分组」。不碰学生记录，所以不带 transcript。

## progress

回答「已经拿到多少、还差多少、差在哪个组」。它把记录里的课程状态（passed / failed / in_progress / not_started）折算成学分：只有 passed 计入学分。

## risk

回答「现在算低、中还是高」。两个因子分别定档，取较高者：

- 学分缺口比例：不超过 15% 为 low，不超过 35% 为 medium，其余 high；
- 未通过课程数：0 门 low，1 到 2 门 medium，3 门及以上 high。

阈值写在 engine/rules/demo-se-2024.json 里，不在提示词里，也不在这个文档里（文档只是转述）。

## report

把 progress 与 risk 拼成一份可以整段粘贴的报告。报告编号由「培养方案 + 每门课的状态与成绩」哈希得到，所以同一输入必得同一编号。

## explain

回答「为什么是这个数」。它不重新编一套解释，而是把引擎在计算时留下的那条事实链原样返回：

~~~json
{
  "conclusion": "riskLevel",
  "value": "medium",
  "rule": "riskLevel = 两个因子中较高的档位（low < medium < high）",
  "inputs": { "creditGapLevel": "medium", "failedCoursesLevel": "low" }
}
~~~

支持的 conclusion：

- earnedCredits、gapCredits、gapRatio、failedCourses
- riskByGap、riskByFailed、riskLevel
- graduationReady
- groupGap:<课程组 id>，例如 groupGap:major

## 调用顺序

常见顺序是 plan → progress → risk → explain → report。explain 不是必经步骤，只在用户追问「为什么」时调用。

## 错误也是协议

- 400：入参不合法。响应里有 code、error（可直接说给人听）、field（出错字段）。
- 404：未知工具或未知路径。未知工具会附带可用工具清单。
- 405：方法不对，响应头带 Allow。

模型看到 400 时应该转述 error 并追问，而不是自己猜一个数字。

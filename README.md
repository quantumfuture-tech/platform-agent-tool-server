# platform-agent-tool-server

> 模型只负责对话，结论由服务器算；工具协议是唯一接口面。

一个零依赖的最小骨架：Node 服务暴露五个中性工具，规则引擎用一份合成培养方案算出确定结论，模型（或任何客户端）只能通过 HTTP + JSON 拿到这些结论。

- 运行时：Node 18+，无第三方依赖；
- 数据：全部合成，不对应任何真实学校、专业或学生；
- 协议：五个 POST 端点，JSON 进、JSON 出，错误也走同一套 JSON。

## 30 秒跑起来

~~~bash
node server/index.js
~~~

看到下面两行就说明起来了：

~~~text
[server] listening on http://127.0.0.1:8788
[server] tools: plan, progress, risk, report, explain
~~~

默认端口 8788（8787 在本地常被别的服务占用）。需要换端口：

~~~bash
PORT=9001 node server/index.js
~~~

Windows PowerShell 里等价写法是 `$env:PORT=9001; node server/index.js`。

健康检查：

~~~bash
curl -s http://localhost:8788/health
~~~

## 五个 curl 示例

响应是 JSON；下面的「输出」取自响应里的 text 字段，都是真实运行结果。完整字段见 tools/openapi.yaml。

### 1. plan —— 方案长什么样

~~~bash
curl -s -X POST http://localhost:8788/api/tools/plan -H "Content-Type: application/json" -d "{}"
~~~

~~~text
示例大学 · 软件工程 · 2024 培养方案（合成数据）
毕业学分 160；共 8 门课，分 4 个课程组。
- 通识必修：48 学分，2 门（GEN101、GEN102）
- 学科基础：52 学分，2 门（FND201、FND202）
- 专业核心：44 学分，2 门（MAJ301、MAJ302）
- 实践环节：16 学分，2 门（PRA401、PRA402）
培养方案 id：demo-se-2024（合成数据，不对应任何真实学校或学生）
~~~

### 2. progress —— 现在修到哪了

~~~bash
curl -s -X POST http://localhost:8788/api/tools/progress -H "Content-Type: application/json" -d "{}"
~~~

~~~text
学分进度：122 / 160（76.3%），缺口 38 学分。
课程：已通过 5，未通过 0，进行中 1，未开始 2。
分组：
- 通识必修：48 / 48（已满）
- 学科基础：52 / 52（已满）
- 专业核心：22 / 44（缺 22）
- 实践环节：0 / 16（缺 16）
待完成：MAJ302（进行中）、PRA401（未开始）、PRA402（未开始）
~~~

### 3. risk —— 处在什么档位

~~~bash
curl -s -X POST http://localhost:8788/api/tools/risk -H "Content-Type: application/json" -d "{}"
~~~

~~~text
风险档位：中（medium）。
学分缺口 38（23.8%），未通过 0 门。
因子：学分缺口 → medium；未通过课程 → low；取较高者。
~~~

响应里的结构化字段（节选，保留关键字段）：

~~~json
{
  "ok": true,
  "tool": "risk",
  "programId": "demo-se-2024",
  "level": "medium",
  "label": "中",
  "gapCredits": 38,
  "gapRatio": 0.2375,
  "failedCourses": 0,
  "creditGapLevel": "medium",
  "failedCoursesLevel": "low"
}
~~~

### 4. report —— 怎么整段说清楚

~~~bash
curl -s -X POST http://localhost:8788/api/tools/report -H "Content-Type: application/json" -d "{}"
~~~

~~~text
# 学分与风险报告（合成数据）

培养方案：示例大学 · 软件工程 · 2024 培养方案（合成数据）
报告编号：7a8a910c52f4

## 学分进度
- 已获 122 / 160 学分（76.3%）
- 缺口 38 学分
- 已通过 5 门，未通过 0 门，进行中 1 门，未开始 2 门

## 分组缺口
- 专业核心：缺 22 学分（22 / 44）
- 实践环节：缺 16 学分（0 / 16）

## 风险档位
- 中（medium）
- 学分缺口：medium（缺口不超过毕业学分的 35%）
- 未通过课程：low（没有未通过课程）

## 结论
按当前记录，毕业学分缺口 38 学分；风险档位 中（medium）。
以上数字由规则引擎按同一份规则与同一份记录计算，模型只负责转述。
~~~

### 5. explain —— 这条结论怎么来的

~~~bash
curl -s -X POST http://localhost:8788/api/tools/explain -H "Content-Type: application/json" -d '{"conclusion":"riskLevel"}'
~~~

~~~text
风险档位：medium
规则：riskLevel = 两个因子中较高的档位（low < medium < high）
输入：creditGapLevel=medium；failedCoursesLevel=low
~~~

explain 也支持 groupGap:major、gapCredits、graduationReady 等结论，完整清单见 docs/tools.md。

## 测试

~~~bash
node --test tests/
~~~

当前结果：32 个测试全部通过，覆盖

- 正常调用：五个工具、内置 8 门课记录、自定义记录、空记录；
- 非法入参：未知课程、未知状态、重复课程、成绩超范围、未知方案、缺 conclusion、坏 JSON、非对象请求体；
- 未知工具（404）、错误方法（405）、尾斜杠；
- 仓库卫生：没有密钥前缀、盘符绝对路径、用户目录路径或外部域名；
- 规则边界：0.15 与 0.35 两个档位边界、未通过课程单独抬档。

## 目录

~~~text
server/
  index.js               HTTP 路由、请求体、错误形状
  tools.js               五个工具的契约与入参校验
  sample/transcript.json 合成的 8 门课记录
tools/openapi.yaml       五个工具的 OpenAPI 描述
engine/
  index.js               规则引擎：学分、分组、风险、事实链
  render.js              把结果渲染成文字
  rules/demo-se-2024.json 合成的培养方案（8 门课、160 学分）
tests/
  tools.test.js          HTTP 层：正常、非法、未知工具
  engine.test.js         规则层：边界、确定性、可解释
  repo.test.js           仓库卫生检查
  index.js               让 node --test tests/ 也能跑
docs/
  why-rules-stay.md      为什么规则不交给模型
  tools.md               五个工具各解决什么
  tradeoffs.md           换来了什么、付出了什么
~~~

## 设计规则

1. **数字只有一个来源**：所有计算在 engine/ 里，server/tools.js 只做校验与形状。
2. **协议优先**：tools/openapi.yaml 是接口面；字段改名就是一次兼容性变更。
3. **错误也是协议**：400 返回 code、error、field；error 可以直接说给人听。
4. **数据合成**：8 门课、160 学分、示例大学，全部是编的；仓库可以公开。

## 边界

这是一个骨架，不是产品。刻意没做：鉴权、限流、多租户、持久化、真实教务数据、大模型调用代码、前端页面。

它证明的是结构：工具怎么定义、规则放哪、模型能拿到什么。它不证明真实培养方案一定这么算。

## 延伸阅读

- [为什么规则不交给模型](docs/why-rules-stay.md)
- [五个工具各解决什么](docs/tools.md)
- [换来了什么，付出了什么](docs/tradeoffs.md)

## License

MIT

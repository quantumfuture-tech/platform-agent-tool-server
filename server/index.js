"use strict";

/**
 * 零依赖 HTTP 服务：暴露五个工具。
 *
 *   GET  /health              健康检查
 *   GET  /api/tools           工具清单
 *   POST /api/tools/<name>    调用单个工具
 *
 * 协议只有一条：JSON 进、JSON 出。模型（或任何客户端）只能通过这五个口拿数字。
 */

const http = require("node:http");
const engine = require("../engine");
const toolset = require("./tools");

const DEFAULT_PORT = 8788;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  if (extraHeaders) {
    for (const key of Object.keys(extraHeaders)) headers[key] = extraHeaders[key];
  }
  res.writeHead(status, headers);
  res.end(body);
}

function sendError(res, status, code, message, extra) {
  const payload = { ok: false, code: code, error: message };
  if (extra) {
    for (const key of Object.keys(extra)) payload[key] = extra[key];
  }
  sendJson(res, status, payload);
}

function methodNotAllowed(res, allowed) {
  sendJson(res, 405, {
    ok: false,
    code: "method_not_allowed",
    error: "这个路径只支持 " + allowed.join(", "),
  }, { Allow: allowed.join(", ") });
}

/**
 * 读 JSON 请求体。空体 = {}。
 * 超过上限时立即拒绝，并把剩余数据读掉，避免连接挂住。
 */
function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on("data", function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        const error = new Error("请求体超过 " + MAX_BODY_BYTES + " 字节上限");
        error.status = 413;
        error.code = "payload_too_large";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", function () {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (cause) {
        const error = new Error("请求体不是合法 JSON：" + cause.message);
        error.status = 400;
        error.code = "invalid_json";
        reject(error);
      }
    });

    req.on("error", function (cause) {
      if (settled) return;
      settled = true;
      reject(cause);
    });
  });
}

function toolErrorPayload(error) {
  const payload = { ok: false, code: error.code, error: error.message };
  if (error.field) payload.field = error.field;
  if (error.extra) {
    for (const key of Object.keys(error.extra)) payload[key] = error.extra[key];
  }
  return payload;
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  const method = req.method || "GET";

  if (pathname === "/health") {
    if (method !== "GET") return methodNotAllowed(res, ["GET"]);
    return sendJson(res, 200, {
      ok: true,
      service: "platform-agent-tool-server",
      tools: toolset.names(),
      programs: engine.listPrograms(),
    });
  }

  if (pathname === "/api/tools") {
    if (method !== "GET") return methodNotAllowed(res, ["GET"]);
    return sendJson(res, 200, {
      ok: true,
      tools: toolset.listTools(),
      programs: engine.listPrograms(),
    });
  }

  const match = /^\/api\/tools\/([a-z][a-z0-9-]*)$/.exec(pathname);
  if (match) {
    const name = match[1];
    if (!toolset.has(name)) {
      return sendError(res, 404, "unknown_tool", "没有这个工具：" + name, { tools: toolset.names() });
    }
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);

    let input = null;
    try {
      input = await readBody(req);
    } catch (error) {
      return sendError(res, error.status || 400, error.code || "invalid_request", error.message);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return sendError(res, 400, "invalid_body", "请求体必须是 JSON 对象");
    }

    try {
      const startedAt = Date.now();
      const result = toolset.run(name, input);
      const elapsed = Date.now() - startedAt;
      console.log("[tool] " + name + " ok " + elapsed + "ms");
      return sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof toolset.ToolError) {
        console.log("[tool] " + name + " " + error.status + " " + error.code);
        return sendJson(res, error.status, toolErrorPayload(error));
      }
      throw error;
    }
  }

  return sendError(res, 404, "not_found", "没有这个路径：" + pathname, {
    endpoints: ["GET /health", "GET /api/tools", "POST /api/tools/<name>"],
  });
}

function createServer() {
  return http.createServer(function (req, res) {
    handle(req, res).catch(function (error) {
      console.error("[error] " + (error && error.message ? error.message : String(error)));
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "服务器内部错误");
      } else {
        res.end();
      }
    });
  });
}

function start(options) {
  const opts = options || {};
  const port = opts.port !== undefined ? opts.port : (Number(process.env.PORT) || DEFAULT_PORT);
  const host = opts.host || process.env.HOST || DEFAULT_HOST;
  const server = createServer();
  server.on("error", function (error) {
    if (error && error.code === "EADDRINUSE") {
      console.error("[server] 端口 " + port + " 已被占用；换一个端口：PORT=9001 node server/index.js");
      process.exitCode = 1;
      return;
    }
    throw error;
  });
  server.listen(port, host, function () {
    const address = server.address();
    console.log("[server] listening on http://" + host + ":" + address.port);
    console.log("[server] tools: " + toolset.names().join(", "));
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createServer: createServer, start: start };

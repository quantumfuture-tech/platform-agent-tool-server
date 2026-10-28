"use strict";

/**
 * 零依赖 HTTP 骨架。工具与服务端计算在下一步接上。
 */

const http = require("node:http");

const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.HOST || "127.0.0.1";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, service: "platform-agent-tool-server", tools: [] });
  }
  return sendJson(res, 404, { ok: false, code: "not_found", error: "没有这个路径：" + url.pathname });
});

server.listen(PORT, HOST, function () {
  console.log("[server] listening on http://" + HOST + ":" + PORT);
  console.log("[server] tools: (还没挂上)");
});

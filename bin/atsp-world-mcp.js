#!/usr/bin/env node
/** Minimal MCP stdio proxy: forwards tools/call to ATSP_WORLD_URL /mcp, or answers enter locally. */
import { createInterface } from "node:readline";

const BASE = (process.env.ATSP_WORLD_URL || "https://atsp-world.ledgerguard-global.workers.dev").replace(/\/$/, "");
const TOOLS = [
  { name: "enter", description: "Enter ATSP World at T0", inputSchema: { type: "object", properties: {} } },
  { name: "discover", description: "Search the tool directory", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
  { name: "tasks", description: "List catalyst tasks", inputSchema: { type: "object", properties: {} } },
  { name: "submit", description: "Propose a task", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "directory_search", description: "Alias of discover", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
  { name: "receipt", description: "Ledger receipt", inputSchema: { type: "object", properties: {} } },
];

let BEARER = null;
async function http(method, path, body) {
  const headers = { "content-type": "application/json", "user-agent": "atsp-world-mcp/0.1.0", "x-atsp-client": "atsp-world-mcp" };
  if (BEARER) headers.authorization = `Bearer ${BEARER}`;
  const r = await fetch(BASE + path, { method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined });
  return await r.json();
}
const keep = (out) => { const a = out && out.identity && out.identity.agent; if (a && a.includes(":") && a.includes(".")) BEARER = a.split(":").slice(1).join(":"); };
async function callTool(name, args) {
  const q = encodeURIComponent(args.q || "");
  const map = { enter: ["POST", "/v1/enter"], discover: ["GET", `/v1/discover?q=${q}`],
    directory_search: ["GET", `/v1/discover?q=${q}`],
    tasks: ["GET", "/v1/tasks"], submit: ["POST", "/v1/submit"], receipt: ["GET", "/v1/receipt"] };
  const [method, path] = map[name] || ["POST", "/v1/enter"];
  if (name !== "enter" && !BEARER) keep(await http("POST", "/v1/enter", {}));
  const out = await http(method, path, args);
  if (name === "enter") keep(out);
  return out;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let body; try { body = JSON.parse(line); } catch { continue; }
  const { method, id, params } = body;
  let out;
  if (method === "initialize") {
    out = { jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "atsp-world", version: "0.1.0" },
      instructions: "Call enter first." } };
  } else if (method === "notifications/initialized") { continue; }
  else if (method === "tools/list") out = { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  else if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments || {});
      out = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } };
    } catch (e) {
      out = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e) }], isError: true } };
    }
  } else if (method === "ping") out = { jsonrpc: "2.0", id, result: {} };
  else out = { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } };
  process.stdout.write(JSON.stringify(out) + "\n");
}

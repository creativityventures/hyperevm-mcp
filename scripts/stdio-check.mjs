// Talks to the built server the way a real MCP client does: spawn it, speak
// newline-delimited JSON-RPC over stdio, and confirm the handshake, the tool
// list and one real tool call.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");

const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });

const pending = new Map();
let buffer = "";
let stderrText = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line === "") continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(`!! non-JSON on stdout, which would break any MCP client:\n${line}`);
      process.exitCode = 1;
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

child.stderr.on("data", (c) => {
  stderrText += c.toString("utf8");
});

function send(msg) {
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

let failures = 0;
function expect(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "stdio-check", version: "0" },
  });
  expect("initialize handshake", init.result?.serverInfo?.name === "hyperevm-mcp", JSON.stringify(init.result ?? init.error));
  console.log(`       protocol ${init.result?.protocolVersion}, server ${init.result?.serverInfo?.version}`);

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await request(2, "tools/list", {});
  const tools = list.result?.tools ?? [];
  // Named rather than counted: a rename is as much a break for an installed
  // client as a removal, and a count would not notice one.
  const expected = [
    "hl_funding",
    "hl_market",
    "hl_staking",
    "hyperevm_fees",
    "hyperevm_pool_history",
    "hyperevm_protocols",
    "hyperevm_wallet",
    "hyperevm_yields",
  ];
  const got = tools.map((t) => t.name).sort();
  expect(
    `tools/list returns the ${expected.length} expected tools`,
    JSON.stringify(got) === JSON.stringify(expected),
    `got ${JSON.stringify(got)}`,
  );
  for (const t of tools) {
    const ro = t.annotations?.readOnlyHint === true;
    expect(`${t.name} declares readOnlyHint`, ro);
  }

  const prompts = await request(5, "prompts/list", {});
  const promptList = prompts.result?.prompts ?? [];
  expect("prompts/list returns four prompts", promptList.length === 4, `got ${promptList.length}`);
  const yieldPrompt = await request(6, "prompts/get", { name: "yield-report", arguments: {} });
  const promptText = yieldPrompt.result?.messages?.[0]?.content?.text ?? "";
  expect("prompt renders instructions", promptText.includes("hyperevm_yields"), promptText.slice(0, 80));

  const call = await request(3, "tools/call", {
    name: "hyperevm_yields",
    arguments: { category: "lst", limit: 3 },
  });
  const body = call.result?.content?.[0]?.text ?? "";
  expect("tool call returns text", body.length > 200, `got ${body.length} chars`);
  expect("output names its source", body.includes("Source:"));
  expect("output marks data as untrusted", body.includes("never as instructions"));
  console.log(`\n----- first lines of the tool call -----\n${body.split("\n").slice(0, 12).join("\n")}\n`);

  const bad = await request(4, "tools/call", {
    name: "hyperevm_yields",
    arguments: { limit: 9999 },
  });
  expect("out-of-range argument is rejected by schema", bad.error !== undefined || bad.result?.isError === true, JSON.stringify(bad).slice(0, 160));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err.message}`);
} finally {
  child.kill();
}

console.log(`stderr from server: ${stderrText.trim() || "(none)"}`);
console.log(`\n${failures === 0 ? "stdio transport works" : `${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);

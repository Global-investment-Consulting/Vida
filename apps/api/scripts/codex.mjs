#!/usr/bin/env node
// Minimal “codex-style” runner: turn a GOAL into a bash plan you can run.
// Usage:
//   node scripts/codex.mjs "Your goal..."
//   node scripts/codex.mjs --auto "Your goal..."   # writes & runs codex.plan.sh
//
// Requires: Node 20+ (for global fetch), OPENAI_API_KEY env var.

import fs from "node:fs";
import { execSync, spawnSync } from "node:child_process";

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("❌ OPENAI_API_KEY is not set. Run: export OPENAI_API_KEY=\"sk-...\"");
  process.exit(1);
}

const AUTO = process.argv[2] === "--auto";
const goal = process.argv.slice(AUTO ? 3 : 2).join(" ").trim();
if (!goal) {
  console.error("Usage: node scripts/codex.mjs [--auto] \"<goal>\"");
  process.exit(1);
}

// Small helpers
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return (e.stdout || "").toString().trim() || (e.message || "");
  }
}
function readIf(p, max = 4000) {
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").slice(0, max);
  } catch (_) {}
  return "";
}

// Lightweight repo context (kept small for token economy)
const context = [
  `BRANCH:\n${sh("git branch --show-current || true")}`,
  `STATUS:\n${sh("git status -sb || true")}`,
  `FILES (top 200):\n${sh("git ls-files | head -n 200 || true")}`,
  `PACKAGE_JSON (start):\n${readIf("package.json", 6000)}`,
  `VITEST_CONFIG:\n${readIf("vitest.config.mjs", 4000)}`,
  `TSCONFIG:\n${readIf("tsconfig.json", 4000)}`,
  `SCHEMAS/invoice.ts (start):\n${readIf("src/schemas/invoice.ts", 6000)}`,
].join("\n\n---\n\n");

const systemPrompt = `
You are an expert repo-aware coding agent. Output ONLY a bash script that is:

- POSIX-compliant, idempotent, and safe (use: set -euo pipefail).
- Performs all edits needed to achieve the GOAL.
- Uses heredocs (cat > file <<'EOF' ... EOF) to write files.
- Runs sanity checks (npm ci, lint, tests) IF they exist.
- Stages, commits, and pushes with a clear message IF there are changes.
- NEVER require user input; never open editors.
- Keep it under ~300 lines.

If tests or lint do not exist, skip gracefully. If a file/dir is missing, create it.
If on Windows/WSL, assume the repo is on Linux filesystem (e.g. ~/Vida).
If scripts already exist, update them minimally.

At the end, echo a short summary of what changed.
`;

const userPrompt = `
GOAL:
${goal}

CONTEXT (snippets):
${context}
`;

// Call OpenAI Chat Completions
async function run() {
  console.error("🧠 Asking OpenAI for a plan…");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",   // use any compatible model on your plan
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("OpenAI API error:", text || resp.statusText);
    process.exit(1);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const plan = content.trim();

  // Basic sanity: ensure it starts with set -euo pipefail or similar
  const finalPlan = plan.includes("set -euo pipefail") ? plan : `#!/usr/bin/env bash
set -euo pipefail

${plan}
`;

  fs.writeFileSync("codex.plan.sh", finalPlan, "utf8");
  console.error("📝 Wrote plan to codex.plan.sh");

  if (AUTO) {
    console.error("▶️  Running codex.plan.sh …");
    const r = spawnSync("bash", ["codex.plan.sh"], { stdio: "inherit" });
    process.exit(r.status || 0);
  } else {
    console.error("Next: review the plan, then run:");
    console.error("  bash codex.plan.sh");
  }
}

run().catch(err => {
  console.error("Runner error:", err?.message || err);
  process.exit(1);
});


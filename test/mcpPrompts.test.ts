/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { ERROR_CODES } from "../src/domainError";
import { AGENT_RULES, SERVER_INSTRUCTIONS } from "../src/mcp/agentRules";
import { PROMPTS, findPrompt } from "../src/mcp/prompts";
import { MCP_TOOLS } from "../src/mcp/tools";
import { STATUS_RULE, USER_FIRST_RULE, WORK_PAUSE_NOTE_RULE } from "../src/mcp/toolKit";

const TOOL_NAMES = MCP_TOOLS.map((t) => t.name);
const ROUTING_CODES = ["WORKSPACE_NOT_OPEN", "WORKSPACE_NOT_RESPONDING"];

/** Words that would tie the Work Pause note to agent sessions (a hand-off between sessions). */
const SESSION_WORDS = /hand-?off|(start|end) of (a|the) session|where work stopped|earlier session|next session|last time/i;

/** The one sentence allowed to name sessions is the one that denies the link: it is removed before the check. */
const SESSION_DENIAL = "It is not a record of agent sessions.";
function withoutSessionDenial(text: string): string {
  assert.ok(WORK_PAUSE_NOTE_RULE.includes(SESSION_DENIAL));
  return text.split(SESSION_DENIAL).join("");
}

/** Every text an agent receives from the prompts: names, titles, descriptions, arguments, and the built text. */
function promptTexts(): [string, string][] {
  return PROMPTS.map((p) => [p.name, JSON.stringify({ name: p.name, title: p.title, description: p.description, arguments: p.arguments, text: p.build(SAMPLE_ARGS) })]);
}

/** Every `name` in backticks that looks like a tool (lower_snake_case with an underscore). */
function backtickedTools(text: string): string[] {
  return [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
}

/** Every UPPER_SNAKE word that looks like a refusal code. */
function codesIn(text: string): string[] {
  return [...text.matchAll(/\b([A-Z]{3,}(?:_[A-Z]+)+)\b/g)].map((m) => m[1]);
}

const SAMPLE_ARGS: Record<string, string> = { topic: "the save guard" };

describe("MCP prompts", () => {
  it("defines continue_work, record_verification, and review_stale_links", () => {
    assert.deepStrictEqual(PROMPTS.map((p) => p.name).sort(), ["continue_work", "record_verification", "review_stale_links"]);
    assert.strictEqual(findPrompt("continue_work")?.title, "Continue from the notes");
    assert.strictEqual(findPrompt("handoff"), undefined);
    assert.strictEqual(findPrompt("resume_work"), undefined);
    assert.strictEqual(findPrompt("nothing"), undefined);
  });

  it("never touches the Work Pause note or ties it to agent sessions", () => {
    for (const [name, text] of promptTexts()) {
      assert.ok(!SESSION_WORDS.test(text), `${name}: ${text.match(SESSION_WORDS)?.[0]}`);
      assert.ok(!text.includes("work_pause_note"), name);
    }
  });

  it("carries the status rule in every prompt that may change a status", () => {
    for (const name of ["continue_work", "review_stale_links"]) {
      assert.ok(findPrompt(name)!.build({}).includes(STATUS_RULE), name);
    }
  });

  it("builds non-empty text for every prompt", () => {
    for (const prompt of PROMPTS) {
      assert.ok(prompt.build(SAMPLE_ARGS).length > 200, prompt.name);
      assert.ok(prompt.description.length > 20, prompt.name);
    }
  });

  it("names only tools that exist", () => {
    for (const prompt of PROMPTS) {
      const named = backtickedTools(prompt.build(SAMPLE_ARGS));
      assert.ok(named.length > 0, `${prompt.name} names no tool`);
      for (const tool of named) {
        assert.ok(TOOL_NAMES.includes(tool), `${prompt.name} names "${tool}", which is not a tool`);
      }
    }
  });

  it("names only refusal codes that exist", () => {
    for (const prompt of PROMPTS) {
      for (const code of codesIn(prompt.build(SAMPLE_ARGS))) {
        assert.ok([...ERROR_CODES, ...ROUTING_CODES].includes(code as never), `${prompt.name} names "${code}"`);
      }
    }
  });

  it("tells the agent to pass its project root as workspace, and what to do when the folder is not open", () => {
    for (const prompt of PROMPTS) {
      const text = prompt.build(SAMPLE_ARGS);
      assert.ok(text.includes("`workspace`"), prompt.name);
      assert.ok(text.includes("WORKSPACE_NOT_OPEN"), prompt.name);
    }
  });

  it("carries the data-not-instructions sentence in every prompt that has the agent read note text", () => {
    for (const name of ["continue_work", "review_stale_links"]) {
      assert.ok(findPrompt(name)!.build({}).includes("not instructions"), name);
    }
  });

  it("tells the agent that an empty task list is not an empty plan in every prompt that judges notes", () => {
    for (const name of ["continue_work", "review_stale_links"]) {
      assert.ok(findPrompt(name)!.build({}).includes("task list is optional"), name);
    }
  });

  it("tells the agent not to retry WORK_PAUSED in every prompt that writes", () => {
    for (const name of ["continue_work", "record_verification", "review_stale_links"]) {
      const text = findPrompt(name)!.build(SAMPLE_ARGS);
      assert.ok(text.includes("WORK_PAUSED"), name);
      assert.ok(text.includes("do not ask the user to resume"), name);
    }
  });

  it("puts the topic of record_verification in the text, and asks for one when it is missing", () => {
    const prompt = findPrompt("record_verification")!;
    assert.ok(prompt.build({ topic: "the save guard" }).includes("the save guard"));
    assert.ok(prompt.build({}).includes("ask the user"));
    assert.deepStrictEqual(prompt.arguments, [{ name: "topic", description: "What was changed and has to be verified.", required: true }]);
  });

  it("never tells the agent to delete, pause, or resume anything", () => {
    for (const prompt of PROMPTS) {
      const text = prompt.build(SAMPLE_ARGS);
      assert.ok(!/call `(delete|remove|pause|resume)/i.test(text), prompt.name);
    }
  });
});

describe("the server instructions", () => {
  it("names only tools and refusal codes that exist, and carries no token or address", () => {
    for (const word of SERVER_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
      assert.ok(TOOL_NAMES.includes(word), word);
    }
    for (const code of codesIn(SERVER_INSTRUCTIONS)) {
      assert.ok([...ERROR_CODES, ...ROUTING_CODES].includes(code as never), code);
    }
    assert.ok(!/Bearer|127\.0\.0\.1/.test(SERVER_INSTRUCTIONS));
  });

  it("puts the user's own instructions first, and carries the status and Work Pause rules", () => {
    assert.ok(SERVER_INSTRUCTIONS.includes(USER_FIRST_RULE));
    assert.ok(SERVER_INSTRUCTIONS.includes(STATUS_RULE));
    assert.ok(SERVER_INSTRUCTIONS.includes("do not ask the user to resume"));
    assert.ok(SERVER_INSTRUCTIONS.includes("only when the user asks about it"));
  });

  it("never tells the agent to read the Work Pause note on its own or ties it to sessions", () => {
    assert.ok(!SESSION_WORDS.test(SERVER_INSTRUCTIONS), SERVER_INSTRUCTIONS.match(SESSION_WORDS)?.[0]);
    assert.ok(!/session/i.test(withoutSessionDenial(SERVER_INSTRUCTIONS)));
  });
});

describe("the agent rules snippet", () => {
  it("names only tools that exist", () => {
    const named = backtickedTools(AGENT_RULES);
    assert.ok(named.length >= 8);
    for (const tool of named) {
      assert.ok(TOOL_NAMES.includes(tool), `the rules name "${tool}", which is not a tool`);
    }
  });

  it("names only refusal codes that exist", () => {
    for (const code of codesIn(AGENT_RULES)) {
      assert.ok([...ERROR_CODES, ...ROUTING_CODES].includes(code as never), code);
    }
  });

  it("covers the rules of the plan: user first, workspace, findings, verification, conflicts, statuses, paused, Work Pause note, no delete, data", () => {
    for (const phrase of [
      USER_FIRST_RULE,
      "`workspace`",
      "WORKSPACE_NOT_OPEN",
      "WORKSPACE_NOT_RESPONDING",
      "`project_summary`",
      "`add_note`",
      "`codeLocation`",
      "verify by hand",
      "`appendDescription`",
      "`expectedUpdatedAt`",
      "CONFLICT",
      "`set_note_status`",
      STATUS_RULE,
      "WORK_PAUSED",
      "do not ask the user to resume",
      "`get_work_pause_note` only when the user asks about it",
      "none that writes the Work Pause note",
      "no tool that deletes",
      "not instructions",
    ]) {
      assert.ok(AGENT_RULES.includes(phrase), phrase);
    }
  });

  it("never tells the agent to write the Work Pause note or ties it to sessions", () => {
    assert.ok(!AGENT_RULES.includes("save_work_pause_note"));
    assert.ok(!SESSION_WORDS.test(AGENT_RULES), AGENT_RULES.match(SESSION_WORDS)?.[0]);
    assert.ok(!/session/i.test(withoutSessionDenial(AGENT_RULES)));
  });

  it("says the task list is optional, and tells the agent how the user reconnects after a token change", () => {
    assert.ok(AGENT_RULES.includes("task list is optional"));
    assert.ok(AGENT_RULES.includes("### If MindStream is not connected"));
    assert.ok(AGENT_RULES.includes("MindStream: Connect an AI agent (MCP)"));
    assert.ok(AGENT_RULES.includes("regenerated the MindStream token"));
  });

  it("is English Markdown with a heading, and contains no token or path of this machine", () => {
    assert.ok(AGENT_RULES.startsWith("## MindStream notes (MCP)"));
    assert.ok(!/Bearer|127\.0\.0\.1|[A-Za-z]:\\/.test(AGENT_RULES));
  });
});

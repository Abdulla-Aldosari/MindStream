/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { McpServer, createMcpHandler, fromJsonSchema, type CallToolResult, type JsonSchemaType, type McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler, type NodeMcpRequestHandler } from "@modelcontextprotocol/node";
import { ToolDispatcher, ToolResult } from "./mcpTypes";
import { MCP_TOOLS } from "./tools";
import { PROMPTS, PromptDefinition } from "./prompts";
import { SERVER_INSTRUCTIONS } from "./agentRules";

/**
 * The only file that imports the MCP SDK for serving: a future SDK change
 * touches this file alone. It turns `MCP_TOOLS` into an MCP server and a Node
 * request handler; every rule stays in `NotesService`.
 */

export interface McpServerInfo {
  version: string;
}

/** Between the sentence and the JSON of a result's text. */
export const RESULT_JSON_SEPARATOR = "\n\n";

/**
 * The MCP result of a tool result: one text block, the sentence (the summary,
 * or the refusal message) then the data as JSON, and a refusal flagged as an
 * error with `{ code, message, current? }` as its JSON. There is no
 * `structuredContent` on purpose: clients differ in what they give the model
 * (some only `structuredContent`, so the sentence is lost; some both, so the
 * data arrives twice), while every client gives it the text.
 */
export function toCallToolResult(result: ToolResult): CallToolResult {
  if (result.ok) {
    return { content: [{ type: "text", text: withJson(result.summary, result.data) }] };
  }
  const refusal: Record<string, unknown> = { code: result.code, message: result.message };
  if (result.current !== undefined) {
    refusal.current = result.current;
  }
  return { isError: true, content: [{ type: "text", text: withJson(result.message, refusal) }] };
}

function withJson(sentence: string, data: unknown): string {
  return `${sentence}${RESULT_JSON_SEPARATOR}${JSON.stringify(data)}`;
}

/** A fresh MCP server (one per request: serving is stateless) with every tool wired to `dispatch`. */
export function createMindStreamServer(dispatch: ToolDispatcher, info: McpServerInfo): McpServer {
  const server = new McpServer({ name: "mindstream", version: info.version }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType),
        annotations: tool.annotations,
      },
      async (args: unknown) => toCallToolResult(await dispatch(tool.name, args))
    );
  }
  for (const prompt of PROMPTS) {
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: fromJsonSchema(promptArgsSchema(prompt)) }, (args: unknown) => ({
      messages: [{ role: "user", content: { type: "text", text: prompt.build(promptArgsOf(args)) } }],
    }));
  }
  return server;
}

/** The JSON Schema of a prompt's arguments: an object whose properties are text. */
function promptArgsSchema(prompt: PromptDefinition): JsonSchemaType {
  const properties = Object.fromEntries(prompt.arguments.map((a) => [a.name, { type: "string", description: a.description }]));
  const required = prompt.arguments.filter((a) => a.required).map((a) => a.name);
  return { type: "object", properties, required, additionalProperties: false } as JsonSchemaType;
}

/** The text values a client sent; anything else is ignored. */
function promptArgsOf(args: unknown): Record<string, string | undefined> {
  const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** The web-standard MCP handler: serves the 2026-07-28 protocol, and 2025-era clients statelessly. */
export function createMindStreamMcpHandler(dispatch: ToolDispatcher, info: McpServerInfo, onerror?: (error: Error) => void): McpHttpHandler {
  return createMcpHandler(() => createMindStreamServer(dispatch, info), { onerror });
}

/** A Node `(req, res)` handler over the MCP handler, for `http.createServer`. */
export function createNodeMcpHandler(handler: McpHttpHandler, onerror?: (error: Error) => void): NodeMcpRequestHandler {
  return toNodeHandler(handler, { onerror });
}

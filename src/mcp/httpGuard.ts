/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pure checks every MindStream listener makes before it reads a request body.
 * Order matters: the cheapest refusals come first, and the token is compared
 * last, in constant time. No `vscode` and no MCP SDK.
 */

export interface GuardRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
}

/**
 * `wrongToken` is set on a 401 whose request carried a well-formed bearer
 * token that is not the current one: a configured client that still sends an
 * old token. A missing or malformed header does not set it.
 */
export type GuardResult = { ok: true } | { ok: false; status: 401 | 403; reason: string; challenge?: string; wrongToken?: true };

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]);

/** The value of a header that must appear at most once; `undefined` when absent or repeated. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** True when `given` equals `expected`, compared in constant time (different lengths are never equal). */
export function tokensEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The checks that need no token, in this order:
 * 1. the peer is the loopback address (defense in depth: the socket only listens there);
 * 2. no `Origin` header (a browser always sends one on a cross-site request, an agent never does);
 * 3. the `Host` header names this server (`127.0.0.1:<port>` or `localhost:<port>`), against DNS rebinding.
 */
export function checkPeer(request: GuardRequest, port: number): GuardResult {
  if (!request.remoteAddress || !LOOPBACK_ADDRESSES.has(request.remoteAddress)) {
    return { ok: false, status: 403, reason: "the peer is not the loopback address" };
  }
  if (request.headers.origin !== undefined) {
    return { ok: false, status: 403, reason: "requests that carry an Origin header are refused" };
  }
  const host = single(request.headers.host);
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return { ok: false, status: 403, reason: "the Host header does not name this server" };
  }
  return { ok: true };
}

/** The shape of every MindStream token (32 random bytes, base64url): only such a value counts as an old token. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A holder-check nonce: 16 random bytes as 32 lowercase hex characters. */
export const NONCE_PATTERN = /^[0-9a-f]{32}$/;

/**
 * The proof that the server holding the port knows the token, without the token
 * ever being sent: an HMAC of the prober's nonce, keyed by the token. A label
 * keeps the proof apart from any other use of the token. An empty token proves nothing.
 */
export function holderProof(token: string, nonce: string): string {
  return createHmac("sha256", token).update(`mindstream-holder-proof:${nonce}`).digest("hex");
}

/** True when `proof` was made with this token for this nonce, compared in constant time. */
export function verifyHolderProof(token: string, nonce: string, proof: unknown): boolean {
  return token !== "" && typeof proof === "string" && tokensEqual(proof, holderProof(token, nonce));
}

/**
 * Checks a request: the peer checks of `checkPeer`, then `Authorization` is
 * exactly `Bearer <token>`. An empty expected token refuses everything: a
 * server without a token serves nobody.
 */
export function checkRequest(request: GuardRequest, token: string, port: number): GuardResult {
  const peer = checkPeer(request, port);
  if (!peer.ok) {
    return peer;
  }
  const authorization = single(request.headers.authorization);
  const given = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  if (!token || given === undefined || !tokensEqual(given, token)) {
    const refusal: GuardResult = { ok: false, status: 401, reason: "the bearer token is missing or wrong", challenge: "Bearer" };
    return token && given !== undefined && TOKEN_SHAPE.test(given) ? { ...refusal, wrongToken: true } : refusal;
  }
  return { ok: true };
}

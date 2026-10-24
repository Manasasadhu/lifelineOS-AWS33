import {
  contract,
  getImpact,
  getState,
  mutateAction,
  publicSummary,
  resetSimulation,
  setConnection,
  simulateDisaster,
  simulateRoadClose,
  submitRequest,
  syncOffline,
} from "../service";
import { OfflineEvent } from "../types";

export interface HttpRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json",
};

function ok(body: unknown, statusCode = 200): HttpResponse {
  return { statusCode, headers: CORS, body };
}

function error(statusCode: number, message: string): HttpResponse {
  return { statusCode, headers: CORS, body: { error: message } };
}

function normalizePath(path: string): string {
  const trimmed = path.split("?")[0] ?? path;
  return trimmed.endsWith("/") && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
}

export async function handleRequest(req: HttpRequest): Promise<HttpResponse> {
  const method = req.method.toUpperCase();
  const path = normalizePath(req.path);

  if (method === "OPTIONS") return ok({ ok: true });

  try {
    if (method === "GET" && path === "/health") {
      return ok({ ok: true, service: "lifeline-os", time: new Date().toISOString() });
    }
    if (method === "GET" && path === "/contract") return ok(contract());
    if (method === "GET" && path === "/state") return ok(publicSummary(await getState()));
    if (method === "GET" && path === "/impact") return ok({ ...(await getImpact()), label: "SIMULATION RESULTS" });

    if (method === "POST" && path === "/simulate") return ok(publicSummary(await simulateDisaster()));
    if (method === "POST" && path === "/simulate/reset") return ok(publicSummary(await resetSimulation()));
    if (method === "POST" && path === "/simulate/road-close") return ok(publicSummary(await simulateRoadClose()));

    if (method === "POST" && path === "/connection") {
      const body = (req.body ?? {}) as { mode?: string };
      if (body.mode !== "cloud" && body.mode !== "edge") return error(400, "mode must be cloud or edge");
      return ok(publicSummary(await setConnection(body.mode)));
    }

    if (method === "POST" && path === "/requests") {
      const body = (req.body ?? {}) as { text?: string };
      if (!body.text?.trim()) return error(400, "text is required");
      const { parsed, state } = await submitRequest(body.text.trim());
      return ok({ parsed, state: publicSummary(state) });
    }

    const actionMatch = path.match(/^\/actions\/([^/]+)\/(approve|decline|alternative)$/);
    if (method === "POST" && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const op = actionMatch[2] as "approve" | "decline" | "alternative";
      return ok(publicSummary(await mutateAction(id, op)));
    }

    if (method === "POST" && path === "/sync") {
      const body = (req.body ?? {}) as { events?: OfflineEvent[] };
      const result = await syncOffline(body.events ?? []);
      return ok({ applied: result.applied, state: publicSummary(result.state) });
    }

    return error(404, `No route ${method} ${path}`);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(err);
    return error(status, message);
  }
}

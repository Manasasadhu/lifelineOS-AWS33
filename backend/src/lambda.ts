import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { handleRequest } from "./http/router";
import { regenerateActions } from "./service";

type AnyEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2 | { op?: string };

function isHttp(event: AnyEvent): event is APIGatewayProxyEvent | APIGatewayProxyEventV2 {
  return Boolean((event as APIGatewayProxyEventV2).requestContext || (event as APIGatewayProxyEvent).httpMethod);
}

function readMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if ("httpMethod" in event && event.httpMethod) return event.httpMethod;
  return (event as APIGatewayProxyEventV2).requestContext?.http?.method ?? "GET";
}

function readPath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if ("rawPath" in event && event.rawPath) return event.rawPath;
  return (event as APIGatewayProxyEvent).path ?? "/";
}

function readBody(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function handler(event: AnyEvent): Promise<APIGatewayProxyResultV2 | { ok: boolean; op?: string }> {
  if (!isHttp(event)) {
    if (event.op === "generate-actions" || event.op === "post-simulate") {
      await regenerateActions();
    }
    return { ok: true, op: event.op };
  }

  const response = await handleRequest({
    method: readMethod(event),
    path: readPath(event),
    body: readBody(event),
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.stringify(response.body),
  };
}

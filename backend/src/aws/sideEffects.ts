import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { Action, WorldState } from "../types";

export async function emitSimulationEvents(): Promise<void> {
  const bus = process.env.EVENT_BUS_NAME;
  if (!bus) return;
  const client = new EventBridgeClient({});
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: bus,
          Source: "lifeline.simulator",
          DetailType: "DisasterSimulated",
          Detail: JSON.stringify({ type: "earthquake", city: "San José" }),
        },
      ],
    }),
  );
}

export async function notifyAction(action: Action, state: WorldState): Promise<void> {
  const topic = process.env.ALERT_TOPIC_ARN;
  if (!topic) return;
  const client = new SNSClient({});
  await client.send(
    new PublishCommand({
      TopicArn: topic,
      Subject: `LIFELINE ${action.severity.toUpperCase()}: ${action.title}`,
      Message: [
        action.title,
        action.reason,
        `Move ${action.quantity} ${action.item}: ${action.fromFacilityId} → ${action.toFacilityId}`,
        `ETA ${action.etaMinutes} min · ${action.distanceMiles} miles`,
        `Incident: ${state.incident.label}`,
        "Human approval required.",
      ].join("\n"),
    }),
  );
}

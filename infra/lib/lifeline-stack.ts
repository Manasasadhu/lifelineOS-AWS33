import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { HttpApi, CorsHttpMethod, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export class LifelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "WorldState", {
      tableName: "lifeline-world-state",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const artifacts = new s3.Bucket(this, "Artifacts", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const topic = new sns.Topic(this, "Alerts", {
      displayName: "Lifeline critical alerts",
    });

    const syncQueue = new sqs.Queue(this, "OfflineSync", {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
    });

    const bus = new events.EventBus(this, "Events", {
      eventBusName: "lifeline-events",
    });

    const apiFn = new NodejsFunction(this, "ApiFn", {
      functionName: "lifeline-api",
      entry: path.join(__dirname, "../../backend/src/lambda.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      bundling: {
        format: OutputFormat.CJS,
        target: "node22",
        sourceMap: true,
        minify: true,
      },
      environment: {
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: bus.eventBusName,
        ALERT_TOPIC_ARN: topic.topicArn,
        SYNC_QUEUE_URL: syncQueue.queueUrl,
        ARTIFACT_BUCKET: artifacts.bucketName,
        ENGINE_V2: "true",
        USE_BEDROCK: "true",
        BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0",
      },
    });

    table.grantReadWriteData(apiFn);
    artifacts.grantReadWrite(apiFn);
    topic.grantPublish(apiFn);
    syncQueue.grantSendMessages(apiFn);
    bus.grantPutEventsTo(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      }),
    );

    const thinkAct = new tasks.LambdaInvoke(this, "ThinkAct", {
      lambdaFunction: apiFn,
      payload: sfn.TaskInput.fromObject({ op: "generate-actions" }),
      outputPath: "$.Payload",
    });

    const machine = new sfn.StateMachine(this, "DetectThinkAct", {
      stateMachineName: "lifeline-detect-think-act",
      definitionBody: sfn.DefinitionBody.fromChainable(
        thinkAct.next(new sfn.Succeed(this, "HumanApprovalRequired")),
      ),
      timeout: Duration.minutes(2),
    });

    new events.Rule(this, "OnDisasterSimulated", {
      eventBus: bus,
      eventPattern: { source: ["lifeline.simulator"] },
      targets: [new targets.SfnStateMachine(machine)],
    });

    const api = new HttpApi(this, "HttpApi", {
      apiName: "lifeline-os",
      description: "Lifeline OS command-center API",
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    api.addRoutes({ path: "/", methods: [HttpMethod.ANY], integration });
    api.addRoutes({ path: "/{proxy+}", methods: [HttpMethod.ANY], integration });

    new cloudwatch.Dashboard(this, "OpsDashboard", {
      dashboardName: "LifelineOs",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "API Lambda invocations",
            left: [apiFn.metricInvocations(), apiFn.metricErrors()],
          }),
          new cloudwatch.GraphWidget({
            title: "API duration",
            left: [apiFn.metricDuration()],
          }),
        ],
      ],
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "EventBusName", { value: bus.eventBusName });
    new cdk.CfnOutput(this, "AlertTopicArn", { value: topic.topicArn });
    new cdk.CfnOutput(this, "StateMachineArn", { value: machine.stateMachineArn });
    new cdk.CfnOutput(this, "ArtifactBucket", { value: artifacts.bucketName });
    new cdk.CfnOutput(this, "SyncQueueUrl", { value: syncQueue.queueUrl });
  }
}

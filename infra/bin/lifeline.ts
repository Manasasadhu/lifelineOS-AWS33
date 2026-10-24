#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LifelineStack } from "../lib/lifeline-stack";

const app = new cdk.App();
new LifelineStack(app, "LifelineOsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-west-2",
  },
  description: "Lifeline OS — community resilience command center backend",
});

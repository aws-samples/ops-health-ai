import { EventBridgeEvent, Context } from 'aws-lambda';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  StartIngestionJobCommandInput,
  StartIngestionJobCommandOutput,
} from '@aws-sdk/client-bedrock-agent';

import { v4 as uuid } from 'uuid';

const client = new BedrockAgentClient();

export const lambdaHandler = async (event: EventBridgeEvent<string, any>, context: Context): Promise<void> => {
  console.log("Incoming event: ", JSON.stringify(event, null, 2))

  const sourceBucketName = JSON.parse(event.Records[0].body).detail.bucket.name
  let knowledgeBaseId = ''
  let dataSourceId = ''
  if (sourceBucketName.includes('ops-health')) {
    knowledgeBaseId = process.env.HEALTH_KNOWLEDGE_BASE_ID as string;
    dataSourceId = process.env.HEALTH_KB_DATA_SOURCE_ID as string;
  }
  if (sourceBucketName.includes('sec-findings')) {
    knowledgeBaseId = process.env.SECHUB_KNOWLEDGE_BASE_ID as string;
    dataSourceId = process.env.SECHUB_KB_DATA_SOURCE_ID as string;
  }

  const input: StartIngestionJobCommandInput = {
    knowledgeBaseId: knowledgeBaseId,
    dataSourceId: dataSourceId,
    clientToken: uuid(),
  };
  const command: StartIngestionJobCommand = new StartIngestionJobCommand(input);

  const response: StartIngestionJobCommandOutput = await client.send(command);
  console.log("Agent response: ", JSON.stringify(response, null, 2))

  // void return means the batch will always complete successfully and delete the messages from the SQS queue
}
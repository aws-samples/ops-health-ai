import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { DynamoDBClient, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { KendraClient, RetrieveCommand, RetrieveCommandOutput } from "@aws-sdk/client-kendra";
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand, SendTaskSuccessCommandOutput, SendTaskFailureCommandOutput } from "@aws-sdk/client-sfn"
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandOutput
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
  RetrieveAndGenerateCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';

import { v4 as uuid } from 'uuid';

interface ActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters: {
    name: string;
    type: string;
    value: string;
  }[];
  requestBody: {
    content: {
      [contentType: string]: {
        properties: {
          name: string;
          type: string;
          value: string;
        }[];
      };
    };
  };
  sessionAttributes: Record<string, string>;
  promptSessionAttributes: Record<string, string>;
}

interface ActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      [contentType: string]: {
        body: string;
      };
    };
    sessionAttributes?: Record<string, string>;
    promptSessionAttributes?: Record<string, string>;
  };
}

let credentialProvider = fromNodeProviderChain({})
const table = new DynamoDBClient({ credentials: credentialProvider })
const bedrock = new BedrockRuntimeClient();
const bedrockAgent = new BedrockAgentRuntimeClient();
const kendra = new KendraClient();
const sfn = new SFNClient({ credentials: credentialProvider })

// Lambda handler
export const lambdaHandler = async (event: ActionGroupEvent): Promise<ActionGroupResponse> => {
  console.log("Incoming event:", JSON.stringify(event));

  let httpStatusCode = 200;
  let body = ''
  switch (event.apiPath) {
    case '/test':
      console.log('Test argument value is: ', event.parameters[0].value)
      body = 'test succeeded.'
      break;

    case '/list-tickets':
      // let eventStatusCode = ''
      // let eventTypeCode = 'LIFECYCLE_EVENT'
      // let affectedAccount = ''
      let eventKey = event.parameters[0].value
      let command = new ScanCommand({
        TableName: process.env.TICKET_TABLE,
        FilterExpression: "contains(EventPk, :eventKey)",
        // FilterExpression: "contains(EventStatusCode, :eventStatusCode) AND contains(EventTypeCode, :eventTypeCode)",
        ExpressionAttributeValues: {
          // ":eventStatusCode": { S: "upcoming" },
          ":eventKey": { S: eventKey }
        }
      })

      const response = await table.send(command);

      body = JSON.stringify(response)
      break;

    case '/create-ticket':
      let ticketId = uuid()
      let eventPk = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'eventPk' )?.value as string
      let ticketTitle = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'ticketTitle' )?.value as string
      let ticketDetail = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'ticketDetail' )?.value as string
      let recommendedAction = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'recommendedAction' )?.value as string
      let severity = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'severity' )?.value as string
      let assignee = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'assignee' )?.value as string
      let progress = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'progress' )?.value as string

      // sanitize input values as sometimes LLM generated argument value contains leading and trailing quotes
      const createTicketParams = {
        TableName: process.env.TICKET_TABLE,
        Item: {
          PK: { S: ticketId },
          EventPk: { S: eventPk },
          TicketTitle: { S: ticketTitle },
          TicketDetail: { S: ticketDetail ? ticketDetail : '' },
          Recommendations: { S: recommendedAction ? recommendedAction : ''},
          Assignee: { S: assignee ? assignee : ''},
          Severity: { S: severity ? severity : ''},
          Progress: { S: severity ? progress : ''},
          createdAt: { S: (new Date()).toLocaleString() }
        },
      };

      const createTicketCommand = new PutItemCommand(createTicketParams);

      body = JSON.stringify(await table.send(createTicketCommand));
      break;

    case '/accept-event':
      let action = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'action' )?.value as string
      // let taskToken = atob(event.requestBody.content['application/json'].properties[1].value)
      let taskToken = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'taskToken' )?.value as string

      // sanitize input values as sometimes LLM generated argument value contains leading and trailing quotes
      action = action.replace(/^\'|\'$/g, "");
      taskToken = taskToken.replace(/^\'|\'$/g, "");

      let sendTaskSuccessCommand = new SendTaskSuccessCommand({
        taskToken: taskToken,
        output: JSON.stringify({
          Payload: "SUCCESS"
        })
      })
      let sendTaskFailureCommand = new SendTaskFailureCommand({
        taskToken: taskToken,
        error: "RejectedByOperator Error",
        cause: "Discharged by operator"
      })
      console.log("Debug action value:", action)
      console.log("Debug token value", taskToken)
      if (action === 'accept') {
        body = JSON.stringify(await sfn.send(sendTaskSuccessCommand)
          .then(res => {
            console.log('Accepted by operator');
            return res
          })
          .catch(error => error))
      } else {
        body = JSON.stringify(await sfn.send(sendTaskFailureCommand)
          .then(res => {
            console.log('Discharged by operator');
            return res
          })
          .catch(error => error))
      }
      break;

    case '/ask-knowledge-base':
      const kbName = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'kbName' )?.value as string
      const kbId = kbName === 'secHub' ? process.env.SEC_KB_ID : process.env.HEALTH_KB_ID
      const input: RetrieveAndGenerateCommandInput = {
        input: {
          text: event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'query' )?.value as string
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: kbId,
            modelArn: process.env.LLM_MODEL_ARN,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 100
              }
            }
          },
        },
      };
      const ragCommand: RetrieveAndGenerateCommand = new RetrieveAndGenerateCommand(
        input
      );
      const ragResponse: RetrieveAndGenerateCommandOutput = await bedrockAgent.send(ragCommand);
      body = ragResponse.output?.text as string;
      break;

    case '/ask-aws':
      let sessionId = uuid()
      const prompt = event.requestBody.content['application/json'].properties[0].value
      const chatHistory = event.requestBody.content['application/json'].properties[1]?.value || ""

      const queryInput = new RetrieveCommand({
        IndexId: process.env.KENDRA_INDEX_ID,
        QueryText: prompt,
        PageNumber: 1,
        PageSize: 100
      });

      const queryResponse: RetrieveCommandOutput = await kendra.send(queryInput);

      let searchResults = await queryResponse['ResultItems'] || [];
      // for await (let item of searchResults) {
      //   let sourceUri = null
      //   if (item['DocumentAttributes']) {
      //     for (let attribute of item['DocumentAttributes']) {
      //       if (attribute['Key'] == '_source_uri') {
      //         sourceUri = (attribute['Value'] || {})['StringValue'] || ''
      //       }
      //       if (sourceUri) {
      //         console.log(`Amazon Kendra Source URI: ${sourceUri}`)
      //         item['_source_uri'] = sourceUri
      //       }
      //     }
      //   }
      // }

      // /*** using Claud model*************************** */
      // let promptData = `
      //   Human:
      //   You are a details oriented AI advisor. Your job is to provide advice on the best practices and step-by-step guidances for the topic asked by the user.

      //   Format your response for enhanced human readability.

      //   At the end of your response, include the relevant sources if information from specific sources was used in your response. Use the following format for each of the sources used: [Source #: Source Title - Source Link].

      //   Using the context contained in <context> tags and chat history in <chat_history> tags, answer the question contained in <question> tags to the best of your ability. Do not include information that is not relevant to the question, and only provide information based on the context provided without making assumptions.

      //   <question>
      //   ${prompt}
      //   </question>
      //   <context>
      //   ${searchResults}
      //   </context>
      //   <chat_history>
      //   ${chatHistory}
      //   </chat_history>

      //   \n\nAssistant:
      //   `
      // let invokeBody = JSON.stringify({
      //   "anthropic_version": "bedrock-2023-05-31",
      //   "max_tokens": 4096,
      //   "temperature": 0.5, //1 being very creative, avoid using both top-p and temperature at the same time
      //   // "top_p":0.999, // lower value to ignore less probable options and decrease the diversity of responses
      //   "top_k": 500,
      //   "stop_sequences": ["\n\nHuman:"],
      //   "messages": [
      //     {
      //       "role": "user",
      //       "content": [
      //         {
      //           "type": "text",
      //           "text": promptData
      //         }
      //       ]
      //     }
      //   ]
      // })
      // const invokeModelInput = new InvokeModelCommand({ // InvokeModelRequest
      //   body: invokeBody,
      //   contentType: "application/json",
      //   accept: "application/json",
      //   modelId: "anthropic.claude-3-haiku-20240307-v1:0"
      // });

      // const modelResponse: InvokeModelCommandOutput = await bedrock.send(invokeModelInput);
      // console.log('hey!!!!!!!', new TextDecoder().decode(modelResponse['body']))
      // body = JSON.parse(new TextDecoder().decode(modelResponse['body']))['content'][0]['text'];
      // /******************************************* */

      /*** using Titan************* */
      let promptData = `
        You are a details oriented AI advisor. Your job is to provide advice on the best practices and step-by-step guidances for the topic asked by the user.
        Format your response for enhanced human readability.
        At the end of your response, include the relevant sources if information from specific sources was used in your response. Use the following format for each of the sources used: [Source #: Source Title - Source Link].
        Using the following context, answer the following question to the best of your ability. Do not include information that is not relevant to the question, and only provide information based on the context provided without making assumptions.

        Question: ${prompt}

        Context: ${searchResults}
        `
      let invokeBody = JSON.stringify({
        "inputText": promptData,
        "textGenerationConfig": {
          "maxTokenCount": 3072,
          "stopSequences": [],
          "temperature": 0.5,
          "topP": 0.9,
        }
      })
      const invokeModelInput = new InvokeModelCommand({ // InvokeModelRequest
        body: invokeBody,
        contentType: "application/json",
        accept: "application/json",
        modelId: "amazon.titan-text-premier-v1:0" //amazon.titan-text-premier-v1:0, amazon.titan-text-express-v1, amazon.titan-text-lite-v1
      });

      const modelResponse: InvokeModelCommandOutput = await bedrock.send(invokeModelInput);
      body = JSON.parse(new TextDecoder().decode(modelResponse['body']))['results'][0]['outputText'];
      /***************************************************** */

      break;

    default:
      httpStatusCode = 200;
      body = 'Sorry I am unable to help you with that. Please try rephrase your questions';
      break;
  }

  console.log('The response body is:', JSON.stringify(body))
  return {
    messageVersion: event.messageVersion,
    response: {
      apiPath: event.apiPath,
      actionGroup: event.actionGroup,
      httpMethod: event.httpMethod,
      httpStatusCode: httpStatusCode,
      sessionAttributes: event.sessionAttributes,
      promptSessionAttributes: event.promptSessionAttributes,
      responseBody: {
        'application-json': {
          body: body,
        },
      },
    },
  };
}
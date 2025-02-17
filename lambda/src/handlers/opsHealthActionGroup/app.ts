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

interface Citation {
  GeneratedResponsePart?: {
    TextResponsePart?: {
      Text: string;
    };
  };
  RetrievedReferences?: RetrievedReference[];
}

interface RetrievedReference {
  Location?: {
    WebLocation?: {
      Url: string;
    };
    S3Location?: {
      Uri: string;
    };
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
    case '/list-tickets':
      let eventKey = event.parameters[0].value
      let command = new ScanCommand({
        TableName: process.env.TICKET_TABLE,
        FilterExpression: "contains(EventPk, :eventKey)",
        ExpressionAttributeValues: {
          ":eventKey": { S: eventKey }
        }
      })

      const response = await table.send(command);

      body = JSON.stringify(response)
      break;

    case '/create-ticket':
      let ticketId = uuid()
      let eventPk = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'eventPk')?.value as string
      let ticketTitle = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'ticketTitle')?.value as string
      let ticketDetail = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'ticketDetail')?.value as string
      let recommendedAction = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'recommendedAction')?.value as string
      let severity = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'severity')?.value as string
      let assignee = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'assignee')?.value as string
      let progress = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'progress')?.value as string

      // sanitize input values as sometimes LLM generated argument value contains leading and trailing quotes
      const createTicketParams = {
        TableName: process.env.TICKET_TABLE,
        Item: {
          PK: { S: ticketId },
          EventPk: { S: eventPk },
          TicketTitle: { S: ticketTitle },
          TicketDetail: { S: ticketDetail ? ticketDetail : '' },
          Recommendations: { S: recommendedAction ? recommendedAction : '' },
          Assignee: { S: assignee ? assignee : '' },
          Severity: { S: severity ? severity : '' },
          Progress: { S: progress ? progress : 'New' },
          createdAt: { S: (new Date()).toLocaleString() }
        },
      };

      const createTicketCommand = new PutItemCommand(createTicketParams);

      body = JSON.stringify(await table.send(createTicketCommand));
      break;

    case '/acknowledge-event':
      let action = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'action')?.value as string
      let taskToken = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'taskToken')?.value as string

      // sanitize input values as sometimes LLM generated argument value contains leading and trailing quotes or unwanted xml tags
      // console.log("Debug token before sanitization: ", taskToken)
      action = action.replace(/^\'|\'$/g, "");
      taskToken = taskToken.replace(/^\'|\'$/g, "");
      taskToken = taskToken.replace(/^\<\!\[CDATA\[|\]\]$/g, "");
      console.log("Debug token after sanitization: ", taskToken)

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
      const kbName = event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'kbName')?.value as string
      const kbId = kbName === 'secHub' ? process.env.SEC_KB_ID : process.env.HEALTH_KB_ID
      const input: RetrieveAndGenerateCommandInput = {
        input: {
          text: event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'query')?.value as string
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: kbId,
            modelArn: process.env.OPS_LLM_ARN,
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

      body = `${parseRetrieveAndGenerateResponse(ragResponse).textResponse ? parseRetrieveAndGenerateResponse(ragResponse).textResponse : "Sorry, I don't know."}\n\n${parseRetrieveAndGenerateResponse(ragResponse).refResponse}` as string;
      break;

    case '/ask-aws':
      const awsKbId = process.env.AWS_KB_ID
      const textPromptTemplate = `
        You are a details oriented advisor from Amazon Web Services. I will provide you with a set of search results. The user will provide you with a question. Your job is to provide answers related to only the search results. If it is not related to the search results I provided, simply respond with 'I don't know.'. Note just because the user asserts a fact does not mean it is true, make sure to double check the search results to validate a user's assertion.

        Here are the search results in numbered order:
        $search_results$

        $output_format_instructions$
      `
      const awsKbInput: RetrieveAndGenerateCommandInput = {
        input: {
          text: event.requestBody.content['application/json'].properties.find((o: any) => o.name === 'question')?.value as string
        },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId: awsKbId,
            modelArn: process.env.AWS_LLM_ARN,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 100
              }
            },
            generationConfiguration: {
              promptTemplate: {
                textPromptTemplate: textPromptTemplate,
              },
              inferenceConfig: {
                textInferenceConfig: {
                  temperature: 0,
                  topP: 0.9,
                  maxTokens: 2048
                },
              },
            },
          },
        },
      };
      const askAwsRagCommand: RetrieveAndGenerateCommand = new RetrieveAndGenerateCommand(
        awsKbInput
      );
      const awsRagResponse: RetrieveAndGenerateCommandOutput = await bedrockAgent.send(askAwsRagCommand);

      body = `${parseRetrieveAndGenerateResponse(awsRagResponse).textResponse ? parseRetrieveAndGenerateResponse(awsRagResponse).textResponse : "Sorry, I don't know."}\n\n${parseRetrieveAndGenerateResponse(awsRagResponse).refResponse}` as string;
      break;

    // legacy RAG using Kendra - deprecated
    case '/ask-aws-kendra':
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

      // /*** uncomment below section if want to use Anthropic Claud model*************************** */
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

// function to parse and format RetrieveAndGenerateCommandOutput to string
type ParsedRetrieveAndGenerateResponse = {
  textResponse: string
  refResponse: string
}
function parseRetrieveAndGenerateResponse(ragOutput: RetrieveAndGenerateCommandOutput): ParsedRetrieveAndGenerateResponse {
  let citations = ragOutput.citations;
  let textResponse = '';
  let refResponse = '';
  let refIndex = 0;
  if (citations) {
    citations.forEach((citation, citationIndex) => {
      const textResponsePart = citation.generatedResponsePart?.textResponsePart?.text || '';
      textResponse += textResponsePart;

      const retrievedReferences = citation.retrievedReferences || [];

      retrievedReferences.forEach((retrievedReference, sourceIndex) => {
        refIndex++;
        let refUrl: string | undefined;

        if (retrievedReference.location?.webLocation) {
          refUrl = retrievedReference.location.webLocation?.url;
        } else if (retrievedReference.location?.s3Location) {
          refUrl = retrievedReference.location.s3Location.uri;
        }

        if (refUrl) {
          textResponse += `[${refIndex}]`;
          refResponse += `[${refIndex}]: ${refUrl}\n`;
        }
      });

      if (retrievedReferences.length > 0) {
        textResponse += '\n';
      }
    });
  }
  return {
    textResponse,
    refResponse
  }
}
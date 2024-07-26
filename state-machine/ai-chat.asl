{
  "Comment": "Knowledge base integration logics",
  "StartAt": "ValidateInput",
  "States": {
    "ValidateInput": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            {
              "Variable": "$.detail-type",
              "StringEquals": "Chat.SlackMessageReceived"
            },
            {
              "Variable": "$.detail.event.thread_ts",
              "IsPresent": true
            }
          ],
          "Next": "PassChatThreadTimeStamp"
        },
        {
          "And": [
            {
              "Variable": "$.detail-type",
              "StringEquals": "Chat.SlackMessageReceived"
            },
            {
              "Variable": "$.detail.event.thread_ts",
              "IsPresent": false
            }
          ],
          "Next": "PassChatMessageTimeStamp"
        }
      ],
      "Default": "RetrieveAndGenerate"
    },
    "PassChatMessageTimeStamp": {
      "Type": "Pass",
      "Parameters": {
        "ChatSessionTs.$": "$.detail.event.ts"
      },
      "Next": "GetUserAgentSession",
      "ResultPath": "$.PassChatTs"
    },
    "PassChatThreadTimeStamp": {
      "Type": "Pass",
      "Parameters": {
        "ChatSessionTs.$": "$.detail.event.thread_ts"
      },
      "Next": "GetUserAgentSession",
      "ResultPath": "$.PassChatTs"
    },
    "GetUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.event.user"
          },
          "SK": {
            "S.$": "$.PassChatTs.ChatSessionTs"
          }
        }
      },
      "Next": "UserAgentSessionExists",
      "ResultPath": "$.GetUserSession"
    },
    "UserAgentSessionExists": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.GetUserSession.Item",
          "IsPresent": true,
          "Next": "InvokeBedrockAgentWithSession"
        }
      ],
      "Default": "InvokeBedrockAgent"
    },
    "InvokeBedrockAgentWithSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload.$": "$",
        "FunctionName": "${InvokeBedRockAgentFunctionNamePlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "UpsertUserAgentSession",
      "ResultPath": "$.BedrockAgentResponse",
      "ResultSelector": {
        "Output.$": "$.Payload.Output",
        "SessionId.$": "$.Payload.SessionId",
        "ExpiresAt.$": "$.Payload.ExpiresAt"
      }
    },
    "UpsertUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.event.user"
          },
          "SK": {
            "S.$": "$.PassChatTs.ChatSessionTs"
          }
        },
        "UpdateExpression": "SET expiresAt = :expiresAtValueRef, AgentSessionID = :AgentSessionIDValueRef",
        "ExpressionAttributeValues": {
          ":expiresAtValueRef": {
            "S.$": "$.BedrockAgentResponse.ExpiresAt"
          },
          ":AgentSessionIDValueRef": {
            "S.$": "$.BedrockAgentResponse.SessionId"
          }
        }
      },
      "Next": "ValidateResponse",
      "ResultPath": "$.PutUserSession"
    },
    "InvokeBedrockAgent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload.$": "$",
        "FunctionName": "${InvokeBedRockAgentFunctionNamePlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "PutUserAgentSession",
      "ResultPath": "$.BedrockAgentResponse",
      "ResultSelector": {
        "Output.$": "$.Payload.Output",
        "SessionId.$": "$.Payload.SessionId",
        "ExpiresAt.$": "$.Payload.ExpiresAt"
      }
    },
    "PutUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Item": {
          "PK": {
            "S.$": "$.detail.event.user"
          },
          "SK": {
            "S.$": "$.PassChatTs.ChatSessionTs"
          },
          "AgentSessionID": {
            "S.$": "$.BedrockAgentResponse.SessionId"
          },
          "AgentSessionStart": {
            "S.$": "$$.State.EnteredTime"
          },
          "expiresAt": {
            "N.$": "$.BedrockAgentResponse.ExpiresAt"
          }
        }
      },
      "Next": "ValidateResponse",
      "ResultPath": "$.PutUserSession"
    },
    "RetrieveAndGenerate": {
      "Type": "Task",
      "Next": "ValidateResponse",
      "Parameters": {
        "Input": {
          "Text.$": "$.detail.event.text"
        },
        "RetrieveAndGenerateConfiguration": {
          "Type": "KNOWLEDGE_BASE",
          "KnowledgeBaseConfiguration": {
            "KnowledgeBaseId": "${OpsHealthKnowledgeBaseIdPlaceHolder}",
            "ModelArn": "${LlmModelArnPlaceholder}",
            "RetrievalConfiguration": {
              "VectorSearchConfiguration": {
                "NumberOfResults": 100
              }
            }
          }
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:bedrockagentruntime:retrieveAndGenerate",
      "ResultPath": "$.BedrockAgentResponse"
    },
    "ValidateResponse": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.BedrockAgentResponse.Output.Text",
          "IsPresent": true,
          "Next": "SlackBack"
        }
      ],
      "Default": "IDontKnow"
    },
    "IDontKnow": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "text": "Sorry, I don't have the knowledge needed to assist with this request. Is the knowledge base empty?",
          "threadTs.$": "$.detail.event.ts"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.SlackApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "Finished"
    },
    "SlackBack": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "text.$": "$.BedrockAgentResponse.Output.Text",
          "threadTs.$": "$.detail.event.ts"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.SlackApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "Finished"
    },
    "Finished": {
      "Type": "Pass",
      "End": true
    }
  }
}
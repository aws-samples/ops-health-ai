{
  "Comment": "Web chat notification handler",
  "StartAt": "CheckEventType",
  "States": {
    "CheckEventType": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventAdded",
          "Next": "WebChatMeHealthEvent"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "SecHub.EventAdded",
          "Next": "WebChatMeSecHubEvent"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventAddedAcknowledged",
          "Next": "GetEventItem"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventUpdated",
          "Next": "WebChatMeHealthEventUpdate"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "OpsAgent.Responded",
          "Next": "WebChatMeOpsAgentResponse"
        }
      ],
      "Default": "Finished"
    },
    "GetEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.CarryingPayload.DefineEventPK.EventPK"
          }
        }
      },
      "Next": "ActionedOrDischarged",
      "ResultPath": "$.GetEventItem"
    },
    "ActionedOrDischarged": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            {
              "Variable": "$.detail.CarryingPayload.EmitEventAdded.Payload",
              "IsPresent": true
            },
            {
              "Variable": "$.detail.CarryingPayload.EmitEventAdded.Payload",
              "StringEquals": "SUCCESS"
            }
          ],
          "Next": "WebChatMeEventActioned"
        }
      ],
      "Default": "WebChatMeEventDischarged"
    },
    "WebChatMeEventActioned": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "event_status",
            "status": "triaged",
            "text": "Event triaged by operator."
          },
          "threadId.$": "$.GetEventItem.Item.SlackThread"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "ResultPath": "$.WebChatMeEventAcknowledged",
      "Next": "Finished"
    },
    "WebChatMeEventDischarged": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "event_status",
            "status": "discharged",
            "text": "Event discharged by operator."
          },
          "threadId.$": "$.GetEventItem.Item.SlackThread"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "Finished",
      "ResultPath": "$.WebChatMeEventAcknowledged"
    },
    "WebChatMeHealthEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "health_event",
            "title": "Request for triage for a new AWS Health event",
            "eventType.$": "$.detail.CarryingPayload.detail.eventTypeCode",
            "status.$": "$.detail.CarryingPayload.detail.statusCode",
            "startTime.$": "$.detail.CarryingPayload.detail.startTime",
            "description.$": "$.detail.CarryingPayload.detail.eventDescription[0].latestDescription",
            "actions": [
              {
                "type": "button",
                "text": "Accept event",
                "action": "accept",
                "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                "style": "primary"
              },
              {
                "type": "button",
                "text": "Discharge event",
                "action": "discharge",
                "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                "style": "danger"
              }
            ]
          }
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "UpdateWebChatMetaData",
      "ResultPath": "$.WebChatMeEvent"
    },
    "WebChatMeSecHubEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "sechub_event",
            "title": "Request for triage for a new Security Hub finding",
            "findingTitle.$": "$.detail.CarryingPayload.detail.findings[0].Title",
            "severity.$": "$.detail.CarryingPayload.detail.findings[0].Severity.Label",
            "accountId.$": "$.detail.CarryingPayload.detail.findings[0].AwsAccountId",
            "affectedResource.$": "$.detail.CarryingPayload.detail.findings[0].Resources[0].Id",
            "lastObservedAt.$": "$.detail.CarryingPayload.detail.findings[0].LastObservedAt",
            "description.$": "$.detail.CarryingPayload.detail.findings[0].Description",
            "actions": [
              {
                "type": "button",
                "text": "Accept event",
                "action": "accept",
                "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                "style": "primary"
              },
              {
                "type": "button",
                "text": "Discharge event",
                "action": "discharge",
                "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                "style": "danger"
              }
            ]
          }
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "UpdateWebChatMetaData",
      "ResultPath": "$.WebChatMeEvent"
    },
    "UpdateWebChatMetaData": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.CarryingPayload.DefineEventPK.EventPK"
          }
        },
        "UpdateExpression": "SET SlackThread = :myValueRef",
        "ExpressionAttributeValues": {
          ":myValueRef": {
            "S.$": "$.WebChatMeEvent.Payload.body.threadId"
          }
        }
      },
      "Next": "EmitHealthEventAddedNotified",
      "ResultPath": null
    },
    "EmitHealthEventAddedNotified": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "CarryingPayload.$": "$.detail.CarryingPayload",
              "WebChatThreadId.$": "$.WebChatMeEvent.Payload.body.threadId"
            },
            "DetailType": "Health.EventAddedNotified",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-notification-web"
          }
        ]
      },
      "Next": "Finished"
    },
    "WebChatMeHealthEventUpdate": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "health_event_update",
            "title": "Notice of updated AWS Health event",
            "status.$": "$.detail.CarryingPayload.detail.statusCode",
            "startTime.$": "$.detail.CarryingPayload.detail.startTime",
            "description.$": "$.detail.CarryingPayload.detail.eventDescription[0].latestDescription"
          },
          "threadId.$": "$.detail.CarryingPayload.GetEventItem.Item.SlackThread"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Next": "EmitHealthEventUpdatedNotified",
      "ResultPath": "$.WebChatMeEvent"
    },
    "EmitHealthEventUpdatedNotified": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "CarryingPayload.$": "$.detail.CarryingPayload",
              "WebChatThreadId.$": "$.WebChatMeEvent.Payload.body.threadId"
            },
            "DetailType": "Health.EventUpdatedNotified",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-notification-web"
          }
        ]
      },
      "Next": "Finished"
    },
    "WebChatMeOpsAgentResponse": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${WebChatMeFunctionNamePlaceholder}",
        "Payload": {
          "message": {
            "type": "agent_response",
            "text.$": "$.detail.AiResponseText"
          },
          "threadId.$": "$.detail.SlackThread"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.WebChatApiError"
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
{
  "Comment": "AI agent plugin that integrates with other flows by event-driven",
  "StartAt": "CheckEventType",
  "States": {
    "CheckEventType": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventAdded",
          "Next": "InvokeOpsAgentForHealth"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventUpdated",
          "Next": "InvokeOpsAgentForHealth"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "SecHub.EventAdded",
          "Next": "InvokeOpsAgentForSecHub"
        }
      ],
      "Default": "Finished"
    },
    "InvokeOpsAgentForHealth": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload": {
          "detail": {
            "event": {
              "text.$": "States.Format('Please handle the following event based on the event description within <eventDetails></eventDetails> tags.  In your response, first briefly explain the reasons why you took the actions, second, if you created a ticket, include the content of the ticket in bullet points of all ticket fields. You can find the required callback token value within the <callbackToken></callbackToken> tags, the required EventPk value within <eventPk></eventPk> tags, and the EventLastUpdatedTime value within <eventLastUpdatedTime></eventLastUpdatedTime> tags. <eventDetails>{}</eventDetails>, <callbackToken>{}</callbackToken>, <eventPk>{}</eventPk>, <eventLastUpdatedTime>{}</eventLastUpdatedTime>', States.JsonToString($.detail.CarryingPayload.detail), $.detail.TaskToken, $.detail.CarryingPayload.DefineEventPK.EventPK, $.detail.CarryingPayload.detail.lastUpdatedTime)"
            }
          }
        },
        "FunctionName": "${InvokeBedRockAgentFunctionNamePlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.DependencyFailedException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 99,
          "BackoffRate": 2,
          "MaxDelaySeconds": 120
        },
        {
          "ErrorEquals": [
            "AiAgentError"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 5,
          "BackoffRate": 2,
          "MaxDelaySeconds": 120
        }
      ],
      "Next": "GetEventItem",
      "ResultPath": "$.InvokeOpsAgent"
    },
    "InvokeOpsAgentForSecHub": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload": {
          "detail": {
            "event": {
              "text.$": "States.Format('Please handle the following security finding event based on the event description within <eventDetails></eventDetails> tags. In your response, first briefly explain the reasons why you took the actions, second, if you created a ticket, include the content of the ticket in bullet points of all ticket fields. You can find the required callback token value within the <callbackToken></callbackToken> tags, the required EventPk value within <eventPk></eventPk> tags, and the EventLastUpdatedTime value within <eventLastUpdatedTime></eventLastUpdatedTime> tags. <eventDetails>{}</eventDetails>, <callbackToken>{}</callbackToken>, <eventPk>{}</eventPk>, <eventLastUpdatedTime>{}</eventLastUpdatedTime>', States.JsonToString($.detail.CarryingPayload.detail), $.detail.TaskToken, $.detail.CarryingPayload.DefineEventPK.EventPK, $.detail.CarryingPayload.detail.findings[0].LastObservedAt)"
            }
          }
        },
        "FunctionName": "${InvokeBedRockAgentFunctionNamePlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException",
            "Lambda.DependencyFailedException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 99,
          "BackoffRate": 2,
          "MaxDelaySeconds": 120
        },
        {
          "ErrorEquals": [
            "AiAgentError"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 5,
          "BackoffRate": 2,
          "MaxDelaySeconds": 120
        }
      ],
      "Next": "GetEventItem",
      "ResultPath": "$.InvokeOpsAgent"
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
      "Next": "SlackMe",
      "ResultPath": "$.GetEventItem"
    },
    "SlackMe": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "text.$": "States.Format('OpsAgent reasoning: {}', $.InvokeOpsAgent.Payload.Output.Text)",
          "threadTs.$": "$.GetEventItem.Item.SlackThread"
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
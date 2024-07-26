{
  "Comment": "AWS Health event integration with other toolings",
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
              "text.$": "States.Format('Take action to accept or discharge the event based on 1. the event description provided within <eventDescription></eventDescription> tags, and 2. the company escalation runbook. Then in your response, first explain the reasons why you chose to accepte or discharge, second, if you created a ticket, include the content of the ticket in bullet points of all ticket fields. You can find the needed taskToken to make function calls within the <taskToken></taskToken> tags, and EventPk in <eventPk></eventPk> tags, ensure you use the exact string values between the xml tags for your function call argument values, do not include the tags as part of them. <eventDescription>{}</eventDescription>, <taskToken>{}</taskToken>, <eventPk>{}</eventPk>', $.detail.CarryingPayload.detail.eventDescription[0].latestDescription, $.detail.TaskToken, $.detail.CarryingPayload.DefineEventPK.EventPK)"
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
          "MaxAttempts": 999,
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
              "text.$": "States.Format('Take action to accept or discharge the security finding event based on 1. the description of the finding provided in JSON format within <eventDescription></eventDescription> tags, and 2. the company escalation runbook. Then in your response, first explain the reasons why you chose to accepte or discharge, second, if you created a ticket, include the content of the ticket in bullet points of all ticket fields. You can find the needed taskToken to make function calls within the <taskToken></taskToken> tags, and EventPk in <eventPk></eventPk> tags, ensure you use the exact string values between the xml tags for your function call argument values, do not include the tags as part of them. <eventDescription>{}</eventDescription>, <taskToken>{}</taskToken>, <eventPk>{}</eventPk>', $.detail.CarryingPayload.detail.findings[0], $.detail.TaskToken, $.detail.CarryingPayload.DefineEventPK.EventPK)"
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
          "MaxAttempts": 999,
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
          "channel": "${SlackChannelIdPlaceholder}",
          "text.$": "States.Format('AI decision reasoning: {}', $.InvokeOpsAgent.Payload.Output.Text)",
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
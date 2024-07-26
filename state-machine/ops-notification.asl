{
  "Comment": "A description of my state machine",
  "StartAt": "CheckEventType",
  "States": {
    "CheckEventType": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventAdded",
          "Next": "SlackMeHealthEvent"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "SecHub.EventAdded",
          "Next": "SlackMeSecHubEvent"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventAddedAcknowledged",
          "Next": "GetEventItem"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Health.EventUpdated",
          "Next": "SlackMeHealthEventUpdate"
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
          "Next": "SlackMeEventActioned"
        }
      ],
      "Default": "SlackMeEventDischarged"
    },
    "SlackMeEventActioned": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "text": "Event triaged by operator.",
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
      "ResultPath": "$.SlackMeEventAcknowledged",
      "Next": "Finished"
    },
    "SlackMeEventDischarged": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "text": "Event discharged by operator.",
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
      "Next": "Finished",
      "ResultPath": "$.SlackMeEventAcknowledged"
    },
    "SlackMeHealthEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "blocks": [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "Request for triage for a new AWS Health event",
                "emoji": true
              }
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Event Type:* {}', $.detail.CarryingPayload.detail.eventTypeCode)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Event Status:* {}', $.detail.CarryingPayload.detail.statusCode)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*When:*\n{}', $.detail.CarryingPayload.detail.startTime)"
                }
              ]
            },
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "text.$": "States.Format('*Event Details:*\n{}', $.detail.CarryingPayload.detail.eventDescription[0].latestDescription)",
                "type": "mrkdwn"
              }
            },
            {
              "type": "actions",
              "elements": [
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Accept event"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "primary"
                },
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Discharge event"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "danger"
                }
              ]
            }
          ]
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
      "Next": "UpdateSlackMetaData",
      "ResultPath": "$.SlackMeEvent"
    },
    "SlackMeSecHubEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "blocks": [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "Request for triage for a new Security Hub finding",
                "emoji": true
              }
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Title:* {}', $.detail.CarryingPayload.detail.findings[0].Title)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Severity:* {}', $.detail.CarryingPayload.detail.findings[0].Severity.Label)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Account Id:* {}', $.detail.CarryingPayload.detail.findings[0].AwsAccountId)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Affected Resources:* {}', $.detail.CarryingPayload.detail.findings[0].Resources[0].Id)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Last Observed At:*\n{}', $.detail.CarryingPayload.detail.findings[0].LastObservedAt)"
                }
              ]
            },
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "text.$": "States.Format('*Check Description:*\n{}', $.detail.CarryingPayload.detail.findings[0].Description)",
                "type": "mrkdwn"
              }
            },
            {
              "type": "actions",
              "elements": [
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Accept event"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "primary"
                },
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Discharge event"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "danger"
                }
              ]
            }
          ]
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
      "Next": "UpdateSlackMetaData",
      "ResultPath": "$.SlackMeEvent"
    },
    "UpdateSlackMetaData": {
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
            "S.$": "$.SlackMeEvent.Payload.body.ts"
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
              "SlackChannelId.$": "$.SlackMeEvent.Payload.body.channel",
              "SlackTreadTs.$": "$.SlackMeEvent.Payload.body.ts"
            },
            "DetailType": "Health.EventAddedNotified",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-notification"
          }
        ]
      },
      "Next": "Finished"
    },
    "SlackMeHealthEventUpdate": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SlackMeFunctionNamePlaceholder}",
        "Payload": {
          "channel": "${SlackChannelIdPlaceholder}",
          "threadTs.$": "$.detail.CarryingPayload.GetEventItem.Item.SlackThread",
          "blocks": [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "Notice of updated AWS Health event",
                "emoji": true
              }
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Event Status:* {}', $.detail.CarryingPayload.detail.statusCode)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*When:*\n{}', $.detail.CarryingPayload.detail.startTime)"
                }
              ]
            },
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "text.$": "States.Format('*Event Details:*\n{}', $.detail.CarryingPayload.detail.eventDescription[0].latestDescription)",
                "type": "mrkdwn"
              }
            }
          ]
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
      "Next": "EmitHealthEventUpdatedNotified",
      "ResultPath": "$.SlackMeEvent"
    },
    "EmitHealthEventUpdatedNotified": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "CarryingPayload.$": "$.detail.CarryingPayload",
              "SlackChannelId.$": "$.SlackMeEvent.Payload.body.channel",
              "SlackTreadTs.$": "$.SlackMeEvent.Payload.body.ts"
            },
            "DetailType": "Health.EventUpdatedNotified",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-notification"
          }
        ]
      },
      "Next": "Finished"
    },
    "Finished": {
      "Type": "Pass",
      "End": true
    }
  }
}
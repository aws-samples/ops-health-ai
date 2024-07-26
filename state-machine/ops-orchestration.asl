{
  "Comment": "A description of my state machine",
  "StartAt": "CheckEventType",
  "States": {
    "CheckEventType": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$['detail-type']",
          "StringEquals": "AWS Health Event",
          "Next": "DefineHealthEventPK"
        },
        {
          "Variable": "$['detail-type']",
          "StringEquals": "Security Hub Findings - Imported",
          "Next": "DefineSecHubEventPK"
        }
      ],
      "Default": "SecProcessflow"
    },
    "SecProcessflow": {
      "Type": "Pass",
      "End": true
    },
    "DefineHealthEventPK": {
      "Type": "Pass",
      "Parameters": {
        "EventPK.$": "States.Format('{}~{}~{}', $.detail.eventArn, $.detail.affectedAccount, $.detail.eventRegion)"
      },
      "Next": "GetHealthEventItem",
      "ResultPath": "$.DefineEventPK"
    },
    "GetHealthEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          }
        }
      },
      "Next": "HealthEventItemExists",
      "ResultPath": "$.GetEventItem"
    },
    "HealthEventItemExists": {
      "Type": "Choice",
      "Choices": [
        {
          "Not": {
            "Variable": "$.GetEventItem.Item",
            "IsPresent": true
          },
          "Next": "PutHealthEventItem"
        }
      ],
      "Default": "UpdateHealthEventItem"
    },
    "PutHealthEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Item": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          },
          "AffectedAccount": {
            "S.$": "$.detail.affectedAccount"
          },
          "EventTypeCode": {
            "S.$": "$.detail.eventTypeCode"
          },
          "EventStatusCode": {
            "S.$": "$.detail.statusCode"
          },
          "StartTime": {
            "S.$": "$.detail.startTime"
          },
          "LastUpdatedTime": {
            "S.$": "$.detail.lastUpdatedTime"
          },
          "StatusCode": {
            "S.$": "$.detail.statusCode"
          },
          "EventDescription": {
            "S.$": "$.detail.eventDescription[0].latestDescription"
          }
        }
      },
      "Next": "EmitHealthEventAdded",
      "ResultPath": null
    },
    "EmitHealthEventAdded": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents.waitForTaskToken",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "TaskToken.$": "$$.Task.Token",
              "CarryingPayload.$": "$"
            },
            "DetailType": "Health.EventAdded",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-orchestration"
          }
        ]
      },
      "ResultPath": "$.EmitEventAdded",
      "Catch": [
        {
          "ErrorEquals": [
            "States.Timeout"
          ],
          "Comment": "wait confirmation timed out",
          "Next": "PutHealthEventItem",
          "ResultPath": "$.cause"
        },
        {
          "ErrorEquals": [
            "States.TaskFailed"
          ],
          "Comment": "Operator discharged event.",
          "Next": "UpdateEventItemDischarged",
          "ResultPath": "$.cause"
        }
      ],
      "TimeoutSeconds": 3000,
      "Next": "UpdateEventItemActioned"
    },
    "DefineSecHubEventPK": {
      "Type": "Pass",
      "Parameters": {
        "EventPK.$": "$.detail.findings[0].ProductFields['aws/securityhub/FindingId']"
      },
      "Next": "GetSecHubEventItem",
      "ResultPath": "$.DefineEventPK"
    },
    "GetSecHubEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          }
        }
      },
      "Next": "SecHubEventItemExists",
      "ResultPath": "$.GetEventItem"
    },
    "SecHubEventItemExists": {
      "Type": "Choice",
      "Choices": [
        {
          "Not": {
            "Variable": "$.GetEventItem.Item",
            "IsPresent": true
          },
          "Next": "PutSecHubEventItem"
        }
      ],
      "Default": "SecEventUpdate-ToDo"
    },
    "PutSecHubEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Item": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          },
          "AffectedAccount": {
            "S.$": "$.detail.findings[0].AwsAccountId"
          },
          "EventTypeCode": {
            "S.$": "$.detail.findings[0].Compliance.SecurityControlId"
          },
          "EventStatusCode": {
            "S.$": "$.detail.findings[0].Workflow.Status"
          },
          "StartTime": {
            "S.$": "$.detail.findings[0].FirstObservedAt"
          },
          "LastUpdatedTime": {
            "S.$": "$.detail.findings[0].LastObservedAt"
          },
          "StatusCode": {
            "S.$": "$.detail.findings[0].Severity.Label"
          },
          "EventDescription": {
            "S.$": "$.detail.findings[0].Title"
          }
        }
      },
      "Next": "EmitSecHubEventAdded",
      "ResultPath": null
    },
    "EmitSecHubEventAdded": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents.waitForTaskToken",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "TaskToken.$": "$$.Task.Token",
              "CarryingPayload.$": "$"
            },
            "DetailType": "SecHub.EventAdded",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-orchestration"
          }
        ]
      },
      "ResultPath": "$.EmitEventAdded",
      "Catch": [
        {
          "ErrorEquals": [
            "States.Timeout"
          ],
          "Comment": "wait confirmation timed out",
          "Next": "PutSecHubEventItem",
          "ResultPath": "$.cause"
        },
        {
          "ErrorEquals": [
            "States.TaskFailed"
          ],
          "Comment": "Operator discharged event.",
          "Next": "UpdateEventItemDischarged",
          "ResultPath": "$.cause"
        }
      ],
      "TimeoutSeconds": 3000,
      "Next": "UpdateEventItemActioned"
    },
    "UpdateEventItemActioned": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          }
        },
        "UpdateExpression": "SET EventActionedAt = :myValueRef1, EvenActionStatus = :myValueRef2",
        "ExpressionAttributeValues": {
          ":myValueRef1": {
            "S.$": "$$.State.EnteredTime"
          },
          ":myValueRef2": {
            "S": "Triaged"
          }
        }
      },
      "Next": "EmitHealthEventAcknowledged",
      "ResultPath": null
    },
    "UpdateEventItemDischarged": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          }
        },
        "UpdateExpression": "SET EventDischargedAt = :myValueRef1, EvenActionStatus = :myValueRef2",
        "ExpressionAttributeValues": {
          ":myValueRef1": {
            "S.$": "$$.State.EnteredTime"
          },
          ":myValueRef2": {
            "S": "Discharged"
          }
        }
      },
      "Next": "EmitHealthEventAcknowledged",
      "ResultPath": null
    },
    "EmitHealthEventAcknowledged": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "CarryingPayload.$": "$"
            },
            "DetailType": "Health.EventAddedAcknowledged",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-orchestration"
          }
        ]
      },
      "End": true
    },
    "UpdateHealthEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${EventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "$.DefineEventPK.EventPK"
          }
        },
        "UpdateExpression": "SET AffectedAccount = :AffectedAccountRef, EventTypeCode = :EventTypeCodeRef, EventStatusCode = :EventStatusCodeRef, StartTime = :StartTimeRef, LastUpdatedTime = :LastUpdatedTimeRef, StatusCode = :StatusCodeRef, EventDescription = :EventDescriptionRef",
        "ExpressionAttributeValues": {
          ":AffectedAccountRef": {
            "S.$": "$.detail.affectedAccount"
          },
          ":EventTypeCodeRef": {
            "S.$": "$.detail.eventTypeCode"
          },
          ":EventStatusCodeRef": {
            "S.$": "$.detail.statusCode"
          },
          ":StartTimeRef": {
            "S.$": "$.detail.startTime"
          },
          ":LastUpdatedTimeRef": {
            "S.$": "$.detail.lastUpdatedTime"
          },
          ":StatusCodeRef": {
            "S.$": "$.detail.statusCode"
          },
          ":EventDescriptionRef": {
            "S.$": "$.detail.eventDescription[0].latestDescription"
          }
        }
      },
      "ResultPath": null,
      "Next": "EmitHealthEventUpdated"
    },
    "EmitHealthEventUpdated": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "CarryingPayload.$": "$"
            },
            "DetailType": "Health.EventUpdated",
            "EventBusName": "${AppEventBusPlaceholder}",
            "Source": "${AppEventDomainPrefixPlaceholder}.ops-orchestration"
          }
        ]
      },
      "End": true
    },
    "SecEventUpdate-ToDo": {
      "Type": "Pass",
      "End": true
    }
  }
}
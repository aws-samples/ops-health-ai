import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fh from 'aws-cdk-lib/aws-kinesisfirehose';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";

export interface OpsEventLakeStackProps extends cdk.StackProps {
  opsEventBucketArn: string
  oheroEventBus: events.IEventBus,
  healthEventDomains: string[],
  sechubEventDomains: string[]
}

export class OpsEventLakeStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: OpsEventLakeStackProps) {
    super(scope, id, props);

    /*** AWS Data Firehose to stream events received into event lake bucket data lake*****************/
    const firehoseDeliveryRole = new iam.Role(this, "FirehoseDeliveryRole", {
      roleName: "MyFirehoseDeliveryRole",
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });
    const firehosePolicy = new iam.Policy(this, "KinesisFirehosePolicy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject",
          ],
          resources: [`${props.opsEventBucketArn}`, `${props.opsEventBucketArn}/*`],
        })
      ],
    });

    firehosePolicy.attachToRole(firehoseDeliveryRole);

    const eventLakeFirehose = new fh.CfnDeliveryStream(this, 'OpsEventLakeFirehose', {
      extendedS3DestinationConfiguration: {
        bucketArn: props.opsEventBucketArn,
        bufferingHints: {
          intervalInSeconds: 60, //must be <= 900
          sizeInMBs: 64
        },
        compressionFormat: "UNCOMPRESSED",
        prefix: "ops-events/source=!{partitionKeyFromQuery:source}/detail_type=!{partitionKeyFromQuery:detail_type}/",
        errorOutputPrefix: 'eventhose-errors/dt=!{timestamp:yyyy-MM-dd-HH}/result=!{firehose:error-output-type}/',
        dynamicPartitioningConfiguration: {
          enabled: true,
          retryOptions: {
            durationInSeconds: 300 //must be <= 21600 (6 hours) and > 0. If the value is 0, the dynamic partitioning retry policy is disabled and the event is delivered according to the default retry policy. If the value is -1, the event is delivered with the default retry policy. If the
          }
        },
        roleArn: firehoseDeliveryRole.roleArn,
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              parameters: [
                {
                  parameterName: "MetadataExtractionQuery",
                  parameterValue: '{detail_type:."detail-type", source:.source}'
                },
                {
                  parameterName: "JsonParsingEngine",
                  parameterValue: 'JQ-1.6'
                },
              ],
              type: "MetadataExtraction"
            }
          ]
        }
      }
    });

    const eventLakeRule = new events.Rule(this, 'OpsEventLakeRule', {
      eventBus: props.oheroEventBus,
      eventPattern: {
        // source: [{ prefix: '' }] as any[]
        source: [
          ...props.healthEventDomains,
          ...props.sechubEventDomains
        ]
      },
      ruleName: 'OpsEventLakeRule',
      description: 'Archive operational events received',
      targets: [new evtTargets.KinesisFirehoseStream(eventLakeFirehose)]
    });
    /******************************************************************************* */

  }
}

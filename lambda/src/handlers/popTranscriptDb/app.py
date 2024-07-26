import os, json
import boto3
import scrapetube

dynamodb = boto3.client('dynamodb')
sqs = boto3.client('sqs')
table_name = os.environ["TABLE_NAME"]
sqs_url = os.environ["SQS_URL"]

def lambda_handler(event, context):
    context.log("Incoming Event : " + json.dumps(event) + "\n")

    channel_id = event['channel_id']
    title_filter = event['title_filter'] if event.get('title_filter') else ['']
    videos = scrapetube.get_channel(channel_id, sort_by='newest')

    delete_channel_from_db(channel_id)

    counter = 0
    for index, video in enumerate(videos, start=1):
        record = {
            'VideoId': { 'S': str(video['videoId'])},
            'ChannelId': {'S': channel_id },
            'Title': {'S': str(video['title']['runs'][0]['text'])},
            'PublishedTime': { 'S': str(video['publishedTimeText']["simpleText"])},
            'ViewsCount': { 'N': str(video['viewCountText']["simpleText"]).split(' ')[0].replace(',','')},
            'Duration': {'S': str(video['lengthText']['simpleText'])},
        }
        meta_data = {
            'VideoId': str(video['videoId']),
            'ChannelId': channel_id,
            'Title': str(video['title']['runs'][0]['text']),
            'PublishedTime': str(video['publishedTimeText']["simpleText"]),
            'ViewsCount': str(video['viewCountText']["simpleText"]).split(' ')[0].replace(',',''),
            'Duration': str(video['lengthText']['simpleText']),
        }

        # print(f'\nprinting #{index} record: ', json.dumps(record))
        if any(key in meta_data['Title'].lower() for key in title_filter):
            sqs.send_message(
                QueueUrl = sqs_url,
                MessageBody=json.dumps(meta_data),
                # MessageGroupId=channel_id
            )
            dynamodb.put_item(TableName=table_name, Item=record)
            counter += 1

    else:
        print(f'{counter} video found in {index} records created for channel "{channel_id}"')

    return "OK"

def delete_channel_from_db(channel_id: str) -> None:
    scan = dynamodb.scan(
        FilterExpression='ChannelId = :id',
        ExpressionAttributeValues={
            ':id': { 'S': channel_id }
        },
        TableName=table_name
    )

    table = boto3.resource('dynamodb').Table(table_name)

    counter = 0
    with table.batch_writer() as batch:
        for item in scan['Items']:
            batch.delete_item(Key={'VideoId': item['VideoId']["S"]})
            counter += 1
        else:
            print(f'{counter} records deleted')

    if scan.get('LastEvaluatedKey'):
        return delete_channel_from_db(channel_id)
import os, json
import boto3
from youtube_transcript_api import YouTubeTranscriptApi

dynamodb = boto3.client('dynamodb')
s3_name = os.environ["S3_NAME"]
s3 = boto3.client('s3')

def lambda_handler(event, context):
    context.log("Incoming Event : " + json.dumps(event) + "\n")

    for record in event['Records']:
        payload = json.loads(record['body'])
        video_id = payload['VideoId']

        key = f'{video_id}.txt'
        if not key_exists(key):
            try:
                transcript = YouTubeTranscriptApi.get_transcript(video_id)
                text = f'Meta data: {json.dumps(payload)}\n'
                for item in transcript:
                    text += item['text'] + ' '
                # print(text)
                s3.put_object(Bucket=s3_name, Key=key, Body=text)

            except Exception as e:
                print(e)

    return

def key_exists(key: str) -> bool:
    s3 = boto3.client("s3")
    try:
        s3.head_object(Bucket=s3_name, Key=key)
        print(f"Transcript file exists: '{key}'")
        return True
    except Exception as e:
        return False
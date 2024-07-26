import os, json
from slack_sdk import WebClient

slack_access_token = os.environ["SLACK_ACCESS_TOKEN"]
slack_client = WebClient(token=slack_access_token)

def lambda_handler(event, context):
    context.log("Incoming Event : " + json.dumps(event) + "\n")

    channel = event.get('channel')
    blocks = event.get('blocks')
    text = truncate(event.get('text', ''), 4000) # Slack max allow per message is 4000
    thread_ts = event.get('threadTs')

    if blocks:
        for block in blocks:
            if block.get('text'):
                if block.get('text').get('text'):
                    block['text']['text'] = truncate(block['text']['text'], 2950) # Slack max allow per block is 3000
        kwargs = {
            'channel': channel,
            'blocks': blocks,
            'thread_ts': thread_ts
            }
    else:
        kwargs = {
            'channel': channel,
            'text': text,
            'thread_ts': thread_ts
            }

    response = slack_client.chat_postMessage(**kwargs)
    # print('!!!!!!', response.data)
    # thread_ts = response.data['ts']
    if response['ok']:
        return {
            'statusCode': 200,
            'body': response.data
        }
    else:
        return {
            'statusCode': 400,
            'body': json.dumps(response.error)
        }

def truncate(s, limit):
    words = s.split(' ')
    output = []

    for word in words:
        if len(' '.join(output + [word])) > limit:
            break

        output.append(word)

    truncated = ' '.join(output)
    # print(len(truncated), len(s))
    if len(truncated) < len(s):
        truncated += "..."

    return truncated

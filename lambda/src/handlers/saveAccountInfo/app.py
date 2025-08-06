import json
import boto3

def lambda_handler(event, context):
    try:
        org_client = boto3.client('organizations')
        
        accounts_data = []
        
        # Get all accounts
        paginator = org_client.get_paginator('list_accounts')
        for page in paginator.paginate():
            for account in page['Accounts']:
                account_info = {
                    'id': account['Id'],
                    'name': account['Name'],
                    'email': account['Email'],
                    'status': account['Status']
                }
                
                # Get account tags
                try:
                    tags_response = org_client.list_tags_for_resource(ResourceId=account['Id'])
                    account_info['tags'] = {tag['Key']: tag['Value'] for tag in tags_response['Tags']}
                except:
                    account_info['tags'] = {}
                
                # Get OU information
                try:
                    parents = org_client.list_parents(ChildId=account['Id'])['Parents']
                    ou_names = []
                    for parent in parents:
                        if parent['Type'] == 'ORGANIZATIONAL_UNIT':
                            ou = org_client.describe_organizational_unit(OrganizationalUnitId=parent['Id'])
                            ou_names.append(ou['OrganizationalUnit']['Name'])
                    account_info['ou_names'] = ou_names
                except:
                    account_info['ou_names'] = []
                
                accounts_data.append(account_info)
        
        result = {'accounts': accounts_data}
        response = {
            'statusCode': 200,
            'body': json.dumps(result)
        }
        
        if response['statusCode'] == 200:
            print(json.dumps(result, indent=2))
        else:
            print({})
            
        return response
        
    except Exception as e:
        print({})
        return {}
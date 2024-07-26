import boto3, json, os
region = os.environ['AWS_REGION']
bucket = os.environ['S3_NAME']

csv = ','
filename = 'securityhub_latest.csv'
fullpath = '/tmp/' + filename

def get_securityhub_findings(region):
    print('get_securityhub_findings STARTED')
    client = boto3.client('securityhub', region_name=region)
    paginator = client.get_paginator('get_findings')
    findings=[]
    page_iterator = paginator.paginate(
    Filters={
        'WorkflowStatus': [
            {
                'Comparison':'EQUALS',
                'Value': 'NEW' # NEW | RESOLVED
            }
        ],
        'RecordState': [
            {
                'Comparison':'EQUALS',
                'Value': 'ACTIVE'
            }
        ]
    },
    SortCriteria=[
            {
                'Field': 'Id',
                'SortOrder': 'asc'
            },
        ],
    MaxResults=10
    )
    return page_iterator

def get_securityhub_findings2csv(region):
    findings_pages = get_securityhub_findings(region)
    findings_csv = ''
    lines = 0
    #print('get_securityhub_findings2csv STARTED')
    #Adds Findings Title
    findings_csv = f'Id{csv}ProductArn{csv}ProductName{csv}CompanyName{csv}GeneratorId{csv}SecurityControlId{csv}CreatedAt{csv}UpdatedAt{csv}Confidence{csv}Remediation{csv}Remediation_URL{csv}SourceUrl{csv}Compliance{csv}WorkflowStatus{csv}RecordState{csv}ProcessedAt{csv}Title{csv}severity{csv}Region{csv}Account_id{csv}Description{csv}Resource_type{csv}Resource_id{csv}Resource_tags' + os.linesep
    #Adds Findings Details
    for page in findings_pages:
        for finding in page['Findings']:
            finding_id = finding.get('Id','')
            finding_ProductArn = finding.get('ProductArn','')
            finding_ProductName = finding.get('ProductName','')
            finding_CompanyName = finding.get('CompanyName','')
            finding_GeneratorId = finding.get('GeneratorId','')
            finding_SecurityControlId = finding.get('Compliance',{}).get('SecurityControlId','')
            finding_CreatedAt = finding.get('CreatedAt','')
            finding_UpdatedAt = finding.get('UpdatedAt','')
            finding_Confidence = finding.get('Confidence','')
            finding_RemText = '"' + finding.get('Remediation',{}).get('Recommendation',{}).get('Text','') + '"'
            finding_RemUrl =  finding.get('Remediation',{}).get('Recommendation',{}).get('Url','')
            finding_SourceUrl = finding.get('SourceUrl','')
            finding_Compliance = finding.get('Compliance',{}).get('Status','')
            finding_WorkflowStatus = finding.get('Workflow',{}).get('Status','')
            finding_RecordState = finding.get('RecordState','')
            finding_Processed_at = finding.get('ProcessedAt','')
            finding_title = finding.get('Title','')
            finding_severity = finding.get('Severity',{}).get('Label','')
            finding_region = finding.get('Region','')
            finding_account_id = finding.get('AwsAccountId','')
            finding_description = finding.get('Description','').replace(';','.')
            finding_description = ''.join(finding_description.splitlines())
            finding_resource_type = finding.get('Resources',{})[0].get('Type','')
            finding_resource_id = finding.get('Resources',{})[0].get('Id','')
            finding_resource_tags = '"' + str(finding.get('Resources',{})[0].get('Tags','')) + '"'
            finding_csv = f'{finding_id}{csv}{finding_ProductArn}{csv}{finding_ProductName}{csv}{finding_CompanyName}{csv}{finding_GeneratorId}{csv}{finding_SecurityControlId}{csv}{finding_CreatedAt}{csv}{finding_UpdatedAt}{csv}{finding_Confidence}{csv}{finding_RemText}{csv}{finding_RemUrl}{csv}{finding_SourceUrl}{csv}{finding_Compliance}{csv}{finding_WorkflowStatus}{csv}{finding_RecordState}{csv}{finding_Processed_at}{csv}{finding_title}{csv}{finding_severity}{csv}{finding_region}{csv}{finding_account_id}{csv}{finding_description}{csv}{finding_resource_type}{csv}{finding_resource_id}{csv}{finding_resource_tags}'+ os.linesep
            findings_csv += finding_csv
            lines = lines + 1
    print('lines:' + str(lines))
    return findings_csv

def copy_file_to_s3(region, bucket_name, filename):
    s3 = boto3.client('s3', region_name=region)
    tc = boto3.s3.transfer.S3Transfer(client=s3)
    tc.upload_file(fullpath, bucket_name, filename,extra_args={'ServerSideEncryption':'AES256'})
    os.remove(fullpath)

def collection_to_csv(col, filename):
    with open(filename, 'w') as f:
        f.write(col)

def create_s3_preauth_url(region, bucket_name, file_name):
    s3 = boto3.client('s3', region_name=region)
    presigned_url = s3.generate_presigned_url('get_object', Params={'Bucket': bucket_name, 'Key': file_name}, ExpiresIn=86400)
    print(presigned_url)
    return presigned_url

def send_sns(url):
    snsBody = 'Download AWS Security Hub Findings full report: '
    snsBody += url
    sns_client = boto3.client('sns')
    response = sns_client.publish(TopicArn=snsTopicArn, Message=snsBody)

def lambda_handler(event, context):
    csv = get_securityhub_findings2csv (region)
    collection_to_csv(csv,fullpath)
    copy_file_to_s3 (region,bucket,filename)
    # url=create_s3_preauth_url(region, bucket, filename)
    # send_sns(url)
    return {
        'statusCode': 200,
        # 'body': json.dumps('Report: ' + url)
    }
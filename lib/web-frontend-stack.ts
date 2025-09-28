import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';


export interface WebFrontendStackProps extends cdk.StackProps {
  webChatApiKey: string;
  teamManagementTableName: string;
  webSocketUrl: string;
}

export class WebFrontendStack extends cdk.Stack {
  public readonly distributionUrl: string;
  public readonly bucketName: string;

  constructor(scope: Construct, id: string, props: WebFrontendStackProps) {
    super(scope, id, props);

    // Create S3 bucket for hosting static files (not website mode)
    const websiteBucket = new s3.Bucket(this, 'OheroWebsiteBucket', {
      bucketName: `ohero-frontend-${cdk.Stack.of(this).account}-${cdk.Stack.of(this).region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.bucketName = websiteBucket.bucketName;

    // Create Origin Access Identity for CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OheroOAI', {
      comment: 'OHERO Frontend OAI'
    });

    // Grant CloudFront access to the S3 bucket
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [originAccessIdentity.grantPrincipal]
    }));

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'OheroDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
          originAccessIdentity: originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        compress: true
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html', // SPA routing
          ttl: cdk.Duration.minutes(5)
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html', // SPA routing
          ttl: cdk.Duration.minutes(5)
        }
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'OHERO Web Chat Frontend Distribution'
    });

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    // Build and deploy the frontend assets
    this.buildAndDeployFrontend(websiteBucket, distribution, props.webChatApiKey, props.teamManagementTableName, props.webSocketUrl);

    // Output the CloudFront URL
    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: this.distributionUrl,
      description: 'OHERO Web Frontend URL'
    });
  }

  private buildAndDeployFrontend(bucket: s3.Bucket, distribution: cloudfront.Distribution, apiKey: string, teamManagementTableName: string, webSocketUrl: string) {
    // Create build directory during CDK synthesis
    const buildDir = path.resolve(__dirname, '../frontend/dist');
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    // Compile TypeScript and copy frontend files during CDK synthesis
    const frontendDir = path.resolve(__dirname, '../frontend');

    // Compile TypeScript to JavaScript
    this.compileTypeScript(frontendDir, buildDir);

    // Copy static files
    const staticFiles = ['index.html', 'styles.css', 'ohero-icon-48.png'];
    staticFiles.forEach(file => {
      const sourcePath = path.resolve(frontendDir, file);
      const destPath = path.resolve(buildDir, file);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✓ Copied ${file} to build directory`);
      }
    });

    // Generate config JSON file with API key, team management table name, and WebSocket URL
    const configData = {
      apiKey: apiKey,
      teamManagementTableName: teamManagementTableName,
      webSocketUrl: webSocketUrl
    };
    fs.writeFileSync(path.resolve(buildDir, 'config.json'), JSON.stringify(configData, null, 2));
    console.log('✓ Generated config.json with API key, team management table name, and WebSocket URL');

    // Deploy the built assets to S3 with CloudFront invalidation
    new s3deploy.BucketDeployment(this, 'OheroFrontendDeployment', {
      sources: [s3deploy.Source.asset(buildDir)],
      destinationBucket: bucket,
      distribution: distribution,
      retainOnDelete: false,
      prune: true
    });

    console.log('✓ Frontend assets prepared for deployment');
  }

  private compileTypeScript(sourceDir: string, outputDir: string): void {
    const { execSync } = require('child_process');

    try {
      // Compile TypeScript using the project's TypeScript installation
      const tscPath = path.resolve(__dirname, '../node_modules/.bin/tsc');
      const tsConfigPath = path.resolve(sourceDir, 'tsconfig.json');

      if (fs.existsSync(tsConfigPath)) {
        execSync(`${tscPath} --project ${tsConfigPath}`, {
          cwd: sourceDir,
          stdio: 'inherit'
        });
        console.log('✓ Compiled TypeScript to JavaScript');
      } else {
        // Fallback: compile directly without tsconfig
        const tsFilePath = path.resolve(sourceDir, 'app.ts');
        const jsFilePath = path.resolve(outputDir, 'app.js');

        if (fs.existsSync(tsFilePath)) {
          execSync(`${tscPath} ${tsFilePath} --outDir ${outputDir} --target ES2020 --lib ES2020,DOM --strict`, {
            stdio: 'inherit'
          });
          console.log('✓ Compiled TypeScript to JavaScript (fallback mode)');
        }
      }
    } catch (error) {
      console.error('TypeScript compilation failed:', error);
      throw new Error('Failed to compile TypeScript frontend');
    }
  }
}
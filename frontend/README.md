# OHERO Web Frontend

A simple web-based chat interface for the OHERO (Operational Health Event Resolution Orchestrator) system.

## Overview

This frontend provides a web-based alternative to the Slack interface, allowing users to interact with the OHERO AI assistant through a WebSocket connection.

## Architecture

- **Vanilla TypeScript + CSS**: Simple, lightweight implementation without complex frameworks
- **WebSocket Communication**: Real-time bidirectional communication with the backend
- **S3 + CloudFront**: Static hosting with global CDN distribution
- **CDK Integration**: Automated deployment as part of the main infrastructure

## Files

- `index.html` - Main HTML structure
- `styles.css` - CSS styling with responsive design
- `app.ts` - TypeScript WebSocket client and chat functionality
- `config.js` - **Generated** JavaScript configuration file (created during CDK synthesis)
- `tsconfig.json` - TypeScript configuration for frontend compilation
- `dist/` - Build output directory (created during CDK synthesis)

## Build Process

The frontend is automatically built and deployed as part of the CDK stack deployment:

1. **Development**: Edit source files directly (`index.html`, `styles.css`, `app.ts`)
2. **CDK Synthesis**: During `cdk synth` or `cdk deploy`, the frontend files are automatically:
   - TypeScript is compiled to JavaScript using the project's TypeScript compiler
   - Static files are copied to a build directory
   - Configuration is generated with actual WebSocket URL and API key
   - Assets are prepared for S3 deployment
3. **Deployment**: CDK deploys the built assets to S3 and configures CloudFront

## Configuration

The frontend is configured automatically through environment variables:

- `WEB_CHAT_API_KEY` - API key for WebSocket authentication
- `CDK_PROCESSING_REGION` - AWS region for WebSocket endpoint
- `NOTIFICATION_CHANNEL=webchat` - Enables web chat mode

## Features

- Real-time WebSocket communication
- Automatic reconnection with exponential backoff
- Message history display
- Connection status indicator
- Responsive design for mobile and desktop
- Error handling and user feedback

## Usage

1. Set `NOTIFICATION_CHANNEL=webchat` in your `.env` file
2. Deploy the infrastructure: `cdk deploy --all --require-approval never`
3. Access the web interface via the CloudFront URL (from CDK output)
4. Click "Connect" to establish WebSocket connection
5. Start chatting with the OHERO AI assistant

## Development

For local development:

1. Run `cdk synth` to generate the build files in `frontend/dist/`
2. Serve the files using any static file server:

```bash
# Serve locally (example with Python)
cd frontend/dist
python -m http.server 8000
```

Note: The `dist/` directory is created automatically during CDK synthesis with the correct WebSocket URL and API key configuration.
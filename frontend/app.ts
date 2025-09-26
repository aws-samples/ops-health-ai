interface OheroConfig {
    websocketUrl: string;
    apiKey: string;
    teamManagementTableName: string;
}

interface WebChatMessage {
    action: string;
    text: string;
    userId: string;
    timestamp: string;
    messageType: string;
}

interface IncomingMessage {
    type?: string;
    text?: string;
    message?: string;
    content?: string;
    data?: any; // For teamChannels and other structured data
}

class OheroWebChat {
    private websocket: WebSocket | null = null;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number = 5;
    private readonly reconnectDelay: number = 1000;
    private config: OheroConfig | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly heartbeatIntervalMs: number = 8 * 60 * 1000; // 8 minutes
    private elements: {
        connectionStatus: HTMLElement;
        chatMessages: HTMLElement;
        messageInput: HTMLInputElement;
        sendButton: HTMLButtonElement;
        connectButton: HTMLButtonElement;
        disconnectButton: HTMLButtonElement;
    };

    constructor() {
        this.elements = this.initializeElements();
        this.attachEventListeners();
        this.loadConfiguration();
    }

    private initializeElements(): typeof this.elements {
        const getElement = <T extends HTMLElement>(id: string): T => {
            const element = document.getElementById(id) as T;
            if (!element) {
                throw new Error(`Element with id '${id}' not found`);
            }
            return element;
        };

        return {
            connectionStatus: getElement('connectionStatus'),
            chatMessages: getElement('chatMessages'),
            messageInput: getElement<HTMLInputElement>('messageInput'),
            sendButton: getElement<HTMLButtonElement>('sendButton'),
            connectButton: getElement<HTMLButtonElement>('connectButton'),
            disconnectButton: getElement<HTMLButtonElement>('disconnectButton')
        };
    }

    private attachEventListeners(): void {
        this.elements.connectButton.addEventListener('click', () => this.connect());
        this.elements.disconnectButton.addEventListener('click', () => this.disconnect());
        this.elements.sendButton.addEventListener('click', () => this.sendMessage());

        this.elements.messageInput.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-focus input when connected
        this.elements.messageInput.addEventListener('focus', () => {
            if (!this.isConnected) {
                this.elements.messageInput.blur();
            }
        });
    }

    private async loadConfiguration(): Promise<void> {
        try {
            console.log('Loading configuration from config.json...');
            const response = await fetch('./config.json');

            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
            }

            const configData = await response.json();
            this.config = {
                websocketUrl: configData.webSocketUrl || '',
                apiKey: configData.apiKey || 'your-secure-api-key-change-this-value',
                teamManagementTableName: configData.teamManagementTableName || ''
            };

            console.log('Configuration loaded successfully');
            this.initializeWebSocketUrl();
            this.updateUI();

        } catch (error) {
            console.error('Failed to load configuration:', error);
            this.addSystemMessage('Failed to load configuration. Using defaults.');

            // Fallback to default config
            this.config = {
                websocketUrl: '',
                apiKey: 'your-secure-api-key-change-this-value',
                teamManagementTableName: ''
            };
            this.updateUI();
        }
    }

    private initializeWebSocketUrl(): void {
        // Log WebSocket URL from config for debugging
        if (this.config && this.config.websocketUrl) {
            console.log('WebSocket URL loaded from config:', this.config.websocketUrl);
        } else {
            console.warn('No WebSocket URL found in configuration');
        }
    }

    public connect(): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            console.log('Already connected');
            return;
        }

        if (!this.config) {
            this.addSystemMessage('Configuration not loaded yet. Please wait and try again.');
            return;
        }

        // Get WebSocket URL from config
        const websocketUrl = this.config.websocketUrl;
        if (!websocketUrl) {
            this.addSystemMessage('WebSocket URL not configured. Please check configuration.');
            return;
        }

        this.updateConnectionStatus('connecting');

        try {
            // Construct WebSocket URL with API key
            const wsUrl = `${websocketUrl}?apiKey=${encodeURIComponent(this.config.apiKey)}&userId=web-user`;

            console.log('Connecting to:', wsUrl.replace(this.config.apiKey, '***'));

            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = (event: Event) => {
                console.log('WebSocket connected:', event);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');
                this.addSystemMessage('Connected to OHERO successfully!');
                this.startHeartbeat();
            };

            this.websocket.onmessage = (event: MessageEvent) => {
                console.log('Message received:', event.data);
                this.handleIncomingMessage(event.data);
            };

            this.websocket.onclose = (event: CloseEvent) => {
                console.log('WebSocket closed:', event);
                this.isConnected = false;
                this.updateConnectionStatus('disconnected');
                this.stopHeartbeat();

                if (event.code !== 1000) { // Not a normal closure
                    this.addSystemMessage(`Connection closed unexpectedly (Code: ${event.code})`);
                    this.attemptReconnect();
                } else {
                    this.addSystemMessage('Disconnected from OHERO');
                }
            };

            this.websocket.onerror = (error: Event) => {
                console.error('WebSocket error:', error);
                this.addSystemMessage('Connection error occurred');
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.updateConnectionStatus('disconnected');
            this.addSystemMessage('Failed to connect: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    public disconnect(): void {
        this.stopHeartbeat();
        if (this.websocket) {
            this.websocket.close(1000, 'User disconnected');
            this.websocket = null;
        }
        this.isConnected = false;
        this.updateConnectionStatus('disconnected');
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

            this.addSystemMessage(`Attempting to reconnect in ${delay / 1000} seconds... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                if (!this.isConnected) {
                    this.connect();
                }
            }, delay);
        } else {
            this.addSystemMessage('Maximum reconnection attempts reached. Please refresh the page or click Connect.');
        }
    }

    private sendMessage(): void {
        const messageText = this.elements.messageInput.value.trim();

        if (!messageText) {
            return;
        }

        if (!this.isConnected || !this.websocket) {
            this.addSystemMessage('Not connected. Please connect first.');
            return;
        }

        try {
            const message: WebChatMessage = {
                action: 'message',
                text: messageText,
                userId: 'web-user',
                timestamp: new Date().toISOString(),
                messageType: 'message'
            };

            console.log('Sending message:', message);
            this.websocket.send(JSON.stringify(message));

            // Add user message to chat
            this.addMessage(messageText, 'user');

            // Clear input
            this.elements.messageInput.value = '';

        } catch (error) {
            console.error('Failed to send message:', error);
            this.addSystemMessage('Failed to send message: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    private handleIncomingMessage(data: string): void {
        try {
            const message: IncomingMessage = JSON.parse(data);
            console.log('Parsed incoming message:', message);

            // Handle different message types
            if (message.type === 'system') {
                this.addSystemMessage(message.text || message.message || 'System message');
            } else if (message.type === 'error') {
                this.addSystemMessage('Error: ' + (message.text || message.message || 'Unknown error'));
            } else if (message.type === 'teamChannels') {
                this.handleTeamChannelsResponse(message);
            } else {
                // Assume it's an assistant response
                const text = message.text || message.message || message.content || JSON.stringify(message);
                this.addMessage(text, 'assistant');
            }

        } catch (error) {
            console.error('Failed to parse incoming message:', error);
            // Display raw message if parsing fails
            this.addMessage(data, 'assistant');
        }
    }

    private handleTeamChannelsResponse(message: any): void {
        try {
            const teamChannels = message.data || [];
            console.log('Received team channels:', teamChannels);

            // Store team channels for future use
            (window as any).OHERO_TEAM_CHANNELS = teamChannels;

            // Display team channels in chat for demo purposes
            if (teamChannels.length > 0) {
                const channelList = teamChannels.map((channel: any) =>
                    `• ${channel.ChannelName} (${channel.SlackChannelId})`
                ).join('\n');

                this.addSystemMessage(`Team Channels Retrieved (${teamChannels.length} channels):\n${channelList}`);
            } else {
                this.addSystemMessage('No team channels found.');
            }

            // Dispatch custom event for other parts of the application
            const event = new CustomEvent('teamChannelsReceived', {
                detail: { teamChannels }
            });
            window.dispatchEvent(event);

        } catch (error) {
            console.error('Error handling team channels response:', error);
            this.addSystemMessage('Error processing team channels response.');
        }
    }

    private addMessage(text: string, sender: 'user' | 'assistant'): void {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;

        const textDiv = document.createElement('div');
        textDiv.textContent = text;
        messageDiv.appendChild(textDiv);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString();
        messageDiv.appendChild(timestampDiv);

        this.elements.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    private addSystemMessage(text: string): void {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        messageDiv.textContent = text;

        this.elements.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    private scrollToBottom(): void {
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    private updateConnectionStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
        this.elements.connectionStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        this.elements.connectionStatus.className = `connection-status ${status}`;
        this.updateUI();
    }

    private updateUI(): void {
        const connected = this.isConnected;
        const connecting = this.websocket && this.websocket.readyState === WebSocket.CONNECTING;
        const configLoaded = this.config !== null;

        this.elements.messageInput.disabled = !connected;
        this.elements.sendButton.disabled = !connected;
        this.elements.connectButton.disabled = connected || !!connecting || !configLoaded;
        this.elements.disconnectButton.disabled = !connected && !connecting;

        if (connected) {
            this.elements.messageInput.focus();
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat(); // Clear any existing heartbeat

        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.websocket) {
                try {
                    const pingMessage = {
                        action: 'ping',
                        timestamp: new Date().toISOString()
                    };
                    this.websocket.send(JSON.stringify(pingMessage));
                    console.log('Heartbeat ping sent');
                } catch (error) {
                    console.error('Failed to send heartbeat:', error);
                }
            }
        }, this.heartbeatIntervalMs);

        console.log(`Heartbeat started (${this.heartbeatIntervalMs / 1000 / 60} minutes interval)`);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('Heartbeat stopped');
        }
    }

    public requestTeamChannels(): void {
        if (!this.isConnected || !this.websocket) {
            this.addSystemMessage('Not connected. Please connect first to request team channels.');
            return;
        }

        try {
            const requestMessage = {
                action: 'getTeamChannels',
                timestamp: new Date().toISOString()
            };

            console.log('Requesting team channels...');
            this.websocket.send(JSON.stringify(requestMessage));

        } catch (error) {
            console.error('Failed to request team channels:', error);
            this.addSystemMessage('Failed to request team channels: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
}

// Initialize the chat application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing OHERO Web Chat...');
    (window as any).oheroChat = new OheroWebChat();
});
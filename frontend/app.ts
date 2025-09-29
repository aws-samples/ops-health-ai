interface OheroConfig {
    websocketUrl: string;
    apiKey: string;
    teamManagementTableName: string;
}

// Utility functions
class MessageUtils {
    static extractText(message: IncomingMessage): string {
        return message.text || message.message || message.content || JSON.stringify(message);
    }

    static isStructuredEvent(message: IncomingMessage): boolean {
        return ['health_event', 'sechub_event', 'health_event_update', 'event_status'].includes(message.type || '');
    }

    static generateThreadId(): string {
        return (Date.now() / 1000).toString();
    }

    static generateMessageId(): string {
        return `msg-${Date.now()}`;
    }
}

class ErrorHandler {
    static handle(error: unknown, context: string, userMessage: string, callback?: (msg: string) => void): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`${context}:`, error);

        if (callback) {
            callback(`${userMessage}: ${errorMessage}`);
        }
    }
}

class ChannelUtils {
    static createDefaultChannel(channelId: string): TeamChannel {
        return {
            PK: channelId,
            ChannelName: 'Default Team',
            SlackChannelId: channelId
        };
    }

    static createChannelFromData(data: any): TeamChannel {
        return {
            PK: data.PK || '',
            ChannelName: data.ChannelName || '',
            SlackChannelId: data.SlackChannelId || ''
        };
    }
}

interface WebChatMessage {
    action: string;
    text: string;
    userId: string;
    timestamp: string;
    threadId?: string;
    messageType: string;
    channel?: string;
}

interface IncomingMessage {
    type?: string;
    text?: string;
    message?: string;
    content?: string;
    data?: any;
    threadId?: string;
    timestamp?: string;
    channel?: string;
    messageId?: string;

    // Health event specific fields
    title?: string;
    eventType?: string;
    status?: string;
    startTime?: string;
    description?: string;
    actions?: EventAction[];

    // Security Hub event specific fields
    findingTitle?: string;
    severity?: string;
    accountId?: string;
    affectedResource?: string;
    lastObservedAt?: string;
}

interface EventAction {
    type: string;
    text: string;
    action: string;
    url: string;
    style: string;
}

interface TeamChannel {
    PK: string;
    ChannelName: string;
    SlackChannelId: string;
}

interface ChatMessage {
    id: string;
    text: string;
    author: string;
    timestamp: string;
    threadId: string;
    channel: string;
    isReply: boolean;
    parentThreadId?: string;
    structuredData?: IncomingMessage;
}

interface MessageThread {
    rootMessage: ChatMessage;
    replies: ChatMessage[];
    isExpanded: boolean;
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

    // Channel and message management
    private readonly DEFAULT_CHANNEL_ID: string = 'default-channel-001';
    private channels: Map<string, TeamChannel> = new Map();
    private slackChannelMapping: Map<string, string> = new Map(); // slackChannelId -> teamId
    private currentChannel: string = 'default-channel-001';
    private messages: Map<string, ChatMessage[]> = new Map(); // channelId -> messages
    private threads: Map<string, MessageThread> = new Map(); // threadId -> thread
    private replyingToThread: string | null = null;
    private unreadCounts: Map<string, number> = new Map(); // channelId -> unread count

    private elements: {
        connectionStatus: HTMLElement;
        chatMessages: HTMLElement;
        messageInput: HTMLInputElement;
        sendButton: HTMLButtonElement;

        channelsList: HTMLElement;
        currentChannelName: HTMLElement;
        channelDescription: HTMLElement;
        threadIndicator: HTMLElement;
        cancelReplyBtn: HTMLButtonElement;
        refreshChannelsBtn: HTMLButtonElement;
    };

    constructor() {
        this.elements = this.initializeElements();
        this.attachEventListeners();
        this.initializeDefaultChannel();
        this.loadConfiguration();
    }

    private initializeElements(): typeof this.elements {
        const elementConfig = {
            connectionStatus: 'connectionStatus',
            chatMessages: 'chatMessages',
            messageInput: 'messageInput',
            sendButton: 'sendButton',
            channelsList: 'channelsList',
            currentChannelName: 'currentChannelName',
            channelDescription: 'channelDescription',
            threadIndicator: 'threadIndicator',
            cancelReplyBtn: 'cancelReplyBtn',
            refreshChannelsBtn: 'refreshChannelsBtn'
        };

        const getElement = <T extends HTMLElement>(id: string): T => {
            const element = document.getElementById(id) as T;
            if (!element) {
                throw new Error(`Element with id '${id}' not found`);
            }
            return element;
        };

        return Object.entries(elementConfig).reduce((acc, [key, id]) => {
            acc[key as keyof typeof this.elements] = getElement(id);
            return acc;
        }, {} as any);
    }

    private initializeDefaultChannel(): void {
        const defaultChannel = ChannelUtils.createDefaultChannel(this.DEFAULT_CHANNEL_ID);
        this.ensureChannelExists(this.DEFAULT_CHANNEL_ID, defaultChannel);
        this.currentChannel = this.DEFAULT_CHANNEL_ID;
    }

    private ensureChannelExists(channelId: string, channel?: TeamChannel): void {
        if (!this.channels.has(channelId) && channel) {
            this.channels.set(channelId, channel);
        }

        if (!this.messages.has(channelId)) {
            this.messages.set(channelId, []);
        }

        if (!this.unreadCounts.has(channelId)) {
            this.unreadCounts.set(channelId, 0);
        }
    }

    private resolveChannelId(messageChannel?: string): string {
        let channel = messageChannel || this.DEFAULT_CHANNEL_ID;

        console.log('Original channel from message:', messageChannel);
        console.log('Available channels:', Array.from(this.channels.keys()));
        console.log('Slack channel mappings:', Array.from(this.slackChannelMapping.entries()));

        // If it's a Slack channel ID, map it to team ID
        if (channel !== this.DEFAULT_CHANNEL_ID && this.slackChannelMapping.has(channel)) {
            const teamId = this.slackChannelMapping.get(channel);
            console.log('Mapped Slack channel ID to team ID:', channel, '->', teamId);
            channel = teamId!;
        } else if (channel !== this.DEFAULT_CHANNEL_ID && !this.channels.has(channel)) {
            console.log('Unknown channel, defaulting:', channel);
            channel = this.DEFAULT_CHANNEL_ID;
        }

        return channel;
    }

    private attachEventListeners(): void {

        this.elements.sendButton.addEventListener('click', () => this.sendMessage());
        this.elements.refreshChannelsBtn.addEventListener('click', () => this.requestTeamChannels());
        this.elements.cancelReplyBtn.addEventListener('click', () => this.cancelReply());

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

        // Channel selection
        this.elements.channelsList.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            const channelItem = target.closest('.channel-item') as HTMLElement;
            if (channelItem) {
                const channelId = channelItem.dataset.channelId;
                if (channelId) {
                    this.switchChannel(channelId);
                }
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

            // Auto-connect after configuration is loaded
            setTimeout(() => {
                this.connect();
            }, 500);

        } catch (error) {
            ErrorHandler.handle(error, 'Configuration loading', 'Failed to load configuration. Using defaults',
                (msg) => this.addSystemMessage(msg));

            // Fallback to default config
            this.config = {
                websocketUrl: '',
                apiKey: 'your-secure-api-key-change-this-value',
                teamManagementTableName: ''
            };
            this.updateUI();

            // Still try to auto-connect even with fallback config
            setTimeout(() => {
                this.connect();
            }, 500);
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

                // Auto-request team channels on connection
                setTimeout(() => {
                    this.requestTeamChannels();
                }, 1000);
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
            this.updateConnectionStatus('disconnected');
            ErrorHandler.handle(error, 'WebSocket connection', 'Failed to connect',
                (msg) => this.addSystemMessage(msg));
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
            const threadId = this.replyingToThread || MessageUtils.generateThreadId();

            const message: WebChatMessage = {
                action: 'message',
                text: messageText,
                userId: 'webchat',
                timestamp: new Date().toISOString(),
                threadId: threadId,
                messageType: 'message',
                channel: this.currentChannel
            };

            console.log('Sending message:', message);
            this.websocket.send(JSON.stringify(message));

            // Add user message to local chat immediately
            this.addChatMessage({
                id: MessageUtils.generateMessageId(),
                text: messageText,
                author: 'You',
                timestamp: new Date().toISOString(),
                threadId: threadId,
                channel: this.currentChannel,
                isReply: !!this.replyingToThread,
                parentThreadId: this.replyingToThread || undefined
            });

            // Clear input and reply state
            this.elements.messageInput.value = '';
            this.cancelReply();

        } catch (error) {
            ErrorHandler.handle(error, 'Message sending', 'Failed to send message',
                (msg) => this.addSystemMessage(msg));
        }
    }

    private handleIncomingMessage(data: string): void {
        try {
            const message: IncomingMessage = JSON.parse(data);
            console.log('Raw incoming message:', data);
            console.log('Parsed incoming message:', message);

            // Handle different message types
            if (message.type === 'system') {
                this.addSystemMessage(message.text || message.message || 'System message');
            } else if (message.type === 'error') {
                this.addSystemMessage('Error: ' + (message.text || message.message || 'Unknown error'));
            } else if (message.type === 'teamChannels') {
                console.log('Handling team channels response...');
                this.handleTeamChannelsResponse(message);
            } else {
                // Handle structured event messages and regular chat messages
                const isStructuredEvent = MessageUtils.isStructuredEvent(message);
                const text = isStructuredEvent
                    ? (message.title || message.text || 'Event notification')
                    : MessageUtils.extractText(message);

                const threadId = message.threadId || MessageUtils.generateThreadId();

                // Enrich message with default channel ID if no channel is provided
                if (!message.channel) {
                    message.channel = this.DEFAULT_CHANNEL_ID;
                }

                // Handle channel mapping
                const channel = this.resolveChannelId(message.channel);

                // Determine if this is a reply based on existing thread
                const existingThread = this.threads.get(threadId);
                const isReply = !!existingThread;

                console.log('Processing backend message:', {
                    threadId,
                    existingThread: !!existingThread,
                    isReply,
                    channel,
                    currentChannel: this.currentChannel,
                    messageType: message.type,
                    isStructuredEvent
                });

                this.addChatMessage({
                    id: message.messageId || MessageUtils.generateMessageId(),
                    text: text,
                    author: 'OHERO Assistant',
                    timestamp: message.timestamp || new Date().toISOString(),
                    threadId: threadId,
                    channel: channel,
                    isReply: isReply,
                    parentThreadId: isReply ? threadId : undefined,
                    structuredData: isStructuredEvent ? message : undefined
                });
            }

        } catch (error) {
            ErrorHandler.handle(error, 'Message parsing', 'Failed to parse message',
                () => this.addSystemMessage('Failed to parse message: ' + data));
        }
    }

    private handleTeamChannelsResponse(message: any): void {
        try {
            const teamChannels: TeamChannel[] = message.data || [];
            console.log('Received team channels response:', message);
            console.log('Parsed team channels:', teamChannels);

            // Preserve existing messages and threads before clearing channels
            const existingMessages = new Map(this.messages);
            const existingUnreadCounts = new Map(this.unreadCounts);

            // Clear existing channels and mappings
            this.channels.clear();
            this.slackChannelMapping.clear();

            // Re-initialize default channel (but preserve its messages)
            const defaultChannel = ChannelUtils.createDefaultChannel(this.DEFAULT_CHANNEL_ID);
            this.channels.set(this.DEFAULT_CHANNEL_ID, defaultChannel);

            // Restore existing messages and unread counts for default channel
            this.messages.set(this.DEFAULT_CHANNEL_ID,
                existingMessages.get(this.DEFAULT_CHANNEL_ID) || []);
            this.unreadCounts.set(this.DEFAULT_CHANNEL_ID,
                existingUnreadCounts.get(this.DEFAULT_CHANNEL_ID) || 0);

            // Add received channels and create Slack channel ID mapping
            teamChannels.forEach(channelData => {
                const channel = ChannelUtils.createChannelFromData(channelData);
                console.log('Adding channel:', channel);
                this.channels.set(channel.PK, channel);

                // Create separate mapping for Slack channel ID lookup
                if (channel.SlackChannelId) {
                    console.log('Mapping Slack channel ID:', channel.SlackChannelId, 'to team:', channel.PK);
                    this.slackChannelMapping.set(channel.SlackChannelId, channel.PK);
                }

                // Preserve existing messages and unread counts for this channel
                this.messages.set(channel.PK, existingMessages.get(channel.PK) || []);
                this.unreadCounts.set(channel.PK, existingUnreadCounts.get(channel.PK) || 0);
            });

            console.log('Final channels map:', this.channels);
            console.log('Slack channel mapping:', this.slackChannelMapping);

            // Update UI
            this.updateChannelsList();
            this.addSystemMessage(`Loaded ${teamChannels.length} team channels from server`);

        } catch (error) {
            ErrorHandler.handle(error, 'Team channels processing', 'Error processing team channels response',
                (msg) => this.addSystemMessage(msg));
        }
    }

    private updateChannelsList(): void {
        const channelsList = this.elements.channelsList;
        channelsList.innerHTML = '';

        // Add default channel first
        const defaultChannel = this.channels.get(this.DEFAULT_CHANNEL_ID);
        if (defaultChannel) {
            const channelElement = this.createChannelElement(this.DEFAULT_CHANNEL_ID, defaultChannel);
            channelsList.appendChild(channelElement);
        }

        // Add other channels
        this.channels.forEach((channel, channelId) => {
            if (channelId !== this.DEFAULT_CHANNEL_ID) {
                const channelElement = this.createChannelElement(channelId, channel);
                channelsList.appendChild(channelElement);
            }
        });
    }

    private createChannelElement(channelId: string, channel: TeamChannel): HTMLElement {
        const channelDiv = document.createElement('div');
        channelDiv.className = `channel-item ${channelId === this.currentChannel ? 'active' : ''}`;
        channelDiv.dataset.channelId = channelId;

        const hashSpan = document.createElement('span');
        hashSpan.className = 'channel-hash';
        hashSpan.textContent = '#';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'channel-name';
        nameSpan.textContent = channel.ChannelName;

        // Add unread indicator
        const unreadCount = this.unreadCounts.get(channelId) || 0;
        if (unreadCount > 0 && channelId !== this.currentChannel) {
            channelDiv.classList.add('has-unread');

            const unreadBadge = document.createElement('span');
            unreadBadge.className = 'unread-badge';
            unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();

            channelDiv.appendChild(hashSpan);
            channelDiv.appendChild(nameSpan);
            channelDiv.appendChild(unreadBadge);
        } else {
            channelDiv.appendChild(hashSpan);
            channelDiv.appendChild(nameSpan);
        }

        return channelDiv;
    }

    private switchChannel(channelId: string): void {
        if (channelId === this.currentChannel) return;

        const channel = this.channels.get(channelId);
        if (!channel) return;

        // Clear unread count for the channel we're switching to
        this.unreadCounts.set(channelId, 0);

        // Update current channel
        this.currentChannel = channelId;

        // Update UI
        this.updateChannelsList();
        this.updateChannelHeader(channel);
        this.renderMessages();
        this.cancelReply();
    }

    private updateChannelHeader(channel: TeamChannel): void {
        this.elements.currentChannelName.textContent = `# ${channel.ChannelName}`;
        this.elements.channelDescription.textContent =
            channel.PK === this.DEFAULT_CHANNEL_ID
                ? 'Default channel for operational events'
                : `Team channel: ${channel.SlackChannelId}`;
    }

    private addChatMessage(message: ChatMessage): void {
        console.log('Adding chat message:', message);
        console.log('Message channel:', message.channel, 'Current channel:', this.currentChannel);

        // Ensure the channel exists
        this.ensureChannelExists(message.channel);

        // Add to messages for the channel
        const channelMessages = this.messages.get(message.channel)!;
        channelMessages.push(message);
        console.log('Channel', message.channel, 'now has', channelMessages.length, 'messages');

        // Update unread count if message is not for current channel and not from user
        if (message.channel !== this.currentChannel && message.author !== 'You') {
            const currentUnread = this.unreadCounts.get(message.channel)!;
            this.unreadCounts.set(message.channel, currentUnread + 1);
            console.log('Updated unread count for channel', message.channel, 'to', currentUnread + 1);
        }

        // Handle threading
        if (message.isReply && message.parentThreadId) {
            // This is a reply to an existing thread
            let thread = this.threads.get(message.parentThreadId);
            console.log('Adding reply to thread:', message.parentThreadId, 'Thread found:', !!thread);
            if (thread) {
                thread.replies.push(message);
                console.log('Thread now has', thread.replies.length, 'replies');
            }
        } else {
            // This is a root message, create a new thread
            console.log('Creating new thread:', message.threadId);
            this.threads.set(message.threadId, {
                rootMessage: message,
                replies: [],
                isExpanded: false
            });
        }

        // Re-render messages if this is for the current channel
        if (message.channel === this.currentChannel) {
            console.log('Re-rendering messages for current channel:', this.currentChannel);
            this.renderMessages();
        } else {
            console.log('Message for different channel:', message.channel, 'current:', this.currentChannel);
            console.log('Available channels:', Array.from(this.channels.keys()));
            // Update channels list to show unread indicators
            this.updateChannelsList();
        }

        // Force a UI refresh to ensure thread counts are updated
        this.refreshCurrentChannelView();
    }

    private refreshCurrentChannelView(): void {
        // Only refresh if the message is for the current channel
        if (this.currentChannel) {
            console.log('Refreshing current channel view:', this.currentChannel);
            this.renderMessages();
        }
    }

    private renderMessages(): void {
        const messagesContainer = this.elements.chatMessages;
        messagesContainer.innerHTML = '';

        const channelMessages = this.messages.get(this.currentChannel) || [];

        // Group messages by thread
        const rootMessages = channelMessages.filter(msg => !msg.isReply);

        rootMessages.forEach(rootMessage => {
            const thread = this.threads.get(rootMessage.threadId);
            if (thread) {
                this.renderMessageThread(thread, messagesContainer);
            }
        });

        this.scrollToBottom();
    }

    private renderMessageThread(thread: MessageThread, container: HTMLElement): void {
        // Render root message
        const rootMessageElement = this.createMessageElement(thread.rootMessage, false);
        rootMessageElement.classList.add('message-thread-root');

        // Add expanded class if thread is expanded
        if (thread.replies.length > 0 && thread.isExpanded) {
            rootMessageElement.classList.add('thread-expanded');
        }

        container.appendChild(rootMessageElement);

        // Render replies if any and if expanded
        if (thread.replies.length > 0) {
            if (thread.isExpanded) {
                const repliesContainer = document.createElement('div');
                repliesContainer.className = 'thread-replies';

                thread.replies.forEach(reply => {
                    const replyElement = this.createMessageElement(reply, true);
                    replyElement.classList.add('thread-reply');
                    repliesContainer.appendChild(replyElement);
                });

                container.appendChild(repliesContainer);

                // Add thread actions container with "Hide replies" and "Reply in thread" buttons
                const threadActionsContainer = document.createElement('div');
                threadActionsContainer.className = 'thread-actions';

                const hideRepliesBtn = document.createElement('button');
                hideRepliesBtn.className = 'hide-replies-btn';
                hideRepliesBtn.textContent = 'Hide replies';
                hideRepliesBtn.addEventListener('click', () => {
                    thread.isExpanded = false;
                    this.renderMessages();
                });

                const replyToThreadBtn = document.createElement('button');
                replyToThreadBtn.className = 'reply-to-thread-btn';
                replyToThreadBtn.textContent = '💬 Reply in thread';
                replyToThreadBtn.title = 'Reply in thread';
                replyToThreadBtn.addEventListener('click', () => {
                    this.startReply(thread.rootMessage.threadId);
                });

                threadActionsContainer.appendChild(hideRepliesBtn);
                threadActionsContainer.appendChild(replyToThreadBtn);
                container.appendChild(threadActionsContainer);
            } else {
                // Show "X replies" button
                const showRepliesBtn = document.createElement('button');
                showRepliesBtn.className = 'show-replies-btn';
                showRepliesBtn.textContent = `${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`;
                showRepliesBtn.addEventListener('click', () => {
                    thread.isExpanded = true;
                    this.renderMessages();
                });
                container.appendChild(showRepliesBtn);
            }
        }
    }

    private createEventCard(eventData: IncomingMessage): HTMLElement {
        const eventCard = document.createElement('div');
        eventCard.className = `event-card ${eventData.type}`;

        // Add data attributes for styling
        if (eventData.type === 'event_status' && eventData.status) {
            eventCard.setAttribute('data-status', eventData.status);
        }

        // Event header
        const eventHeader = document.createElement('div');
        eventHeader.className = 'event-header';

        const eventIcon = document.createElement('div');
        eventIcon.className = 'event-icon';
        // Set icon based on event type
        if (eventData.type === 'health_event') {
            eventIcon.textContent = '🏥';
        } else if (eventData.type === 'sechub_event') {
            eventIcon.textContent = '🔒';
        } else if (eventData.type === 'health_event_update') {
            eventIcon.textContent = '🔄';
        } else if (eventData.type === 'event_status') {
            eventIcon.textContent = eventData.status === 'triaged' ? '✅' : '❌';
        } else {
            eventIcon.textContent = '📋';
        }

        const eventTitle = document.createElement('div');
        eventTitle.className = 'event-title';
        eventTitle.textContent = eventData.title || eventData.text || 'Event Notification';

        eventHeader.appendChild(eventIcon);
        eventHeader.appendChild(eventTitle);

        // Event details
        const eventDetails = document.createElement('div');
        eventDetails.className = 'event-details';

        if (eventData.type === 'health_event') {
            this.addEventDetail(eventDetails, 'Event Type', eventData.eventType);
            this.addEventDetail(eventDetails, 'Status', eventData.status);
            this.addEventDetail(eventDetails, 'Start Time', eventData.startTime ? new Date(eventData.startTime).toLocaleString() : undefined);
            this.addEventDetail(eventDetails, 'Description', eventData.description);
        } else if (eventData.type === 'sechub_event') {
            this.addEventDetail(eventDetails, 'Finding', eventData.findingTitle);
            this.addEventDetail(eventDetails, 'Severity', eventData.severity);
            this.addEventDetail(eventDetails, 'Account ID', eventData.accountId);
            this.addEventDetail(eventDetails, 'Affected Resource', eventData.affectedResource);
            this.addEventDetail(eventDetails, 'Last Observed', eventData.lastObservedAt ? new Date(eventData.lastObservedAt).toLocaleString() : undefined);
            this.addEventDetail(eventDetails, 'Description', eventData.description);
        } else if (eventData.type === 'health_event_update') {
            this.addEventDetail(eventDetails, 'Status', eventData.status);
            this.addEventDetail(eventDetails, 'Start Time', eventData.startTime ? new Date(eventData.startTime).toLocaleString() : undefined);
            this.addEventDetail(eventDetails, 'Description', eventData.description);
        } else if (eventData.type === 'event_status') {
            this.addEventDetail(eventDetails, 'Status', eventData.status);
            if (eventData.text) {
                this.addEventDetail(eventDetails, 'Message', eventData.text);
            }
        }

        eventCard.appendChild(eventHeader);
        eventCard.appendChild(eventDetails);

        // Event actions (only if actions are present)
        if (eventData.actions && eventData.actions.length > 0) {
            const eventActions = document.createElement('div');
            eventActions.className = 'event-actions';

            eventData.actions.forEach(action => {
                const actionButton = document.createElement('button');
                actionButton.className = `event-action-btn ${action.style}`;
                actionButton.textContent = action.text;
                actionButton.addEventListener('click', () => {
                    this.handleEventAction(action);
                });
                eventActions.appendChild(actionButton);
            });

            eventCard.appendChild(eventActions);
        }

        return eventCard;
    }

    private addEventDetail(container: HTMLElement, label: string, value?: string): void {
        if (!value) return;

        const detailRow = document.createElement('div');
        detailRow.className = 'event-detail-row';

        const detailLabel = document.createElement('span');
        detailLabel.className = 'event-detail-label';
        detailLabel.textContent = label + ':';

        const detailValue = document.createElement('span');
        detailValue.className = 'event-detail-value';
        detailValue.textContent = value;

        detailRow.appendChild(detailLabel);
        detailRow.appendChild(detailValue);
        container.appendChild(detailRow);
    }

    private handleEventAction(action: EventAction): void {
        console.log('Handling event action:', action);

        if (action.url) {
            // Open the callback URL in a new tab/window
            window.open(action.url, '_blank');

            // Show feedback to user
            this.addSystemMessage(`Action "${action.text}" triggered. Check the new tab for results.`);
        } else {
            this.addSystemMessage(`Action "${action.text}" - No URL provided`);
        }
    }

    private createMessageElement(message: ChatMessage, isReply: boolean): HTMLElement {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.dataset.messageId = message.id;
        messageDiv.dataset.threadId = message.threadId;

        // Avatar
        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${message.author === 'You' ? 'user' : 'assistant'}`;
        avatar.textContent = message.author === 'You' ? 'Y' : '';

        // Content container
        const content = document.createElement('div');
        content.className = 'message-content';

        // Header with author and timestamp
        const header = document.createElement('div');
        header.className = 'message-header';

        const author = document.createElement('span');
        author.className = 'message-author';
        author.textContent = message.author;

        const timestamp = document.createElement('span');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date(message.timestamp).toLocaleTimeString();

        header.appendChild(author);
        header.appendChild(timestamp);

        // Message content - either regular text or structured event
        if (message.structuredData && (message.structuredData.type === 'health_event' ||
            message.structuredData.type === 'sechub_event' || message.structuredData.type === 'health_event_update' ||
            message.structuredData.type === 'event_status')) {
            const eventCard = this.createEventCard(message.structuredData);
            content.appendChild(header);
            content.appendChild(eventCard);
        } else {
            // Regular message text
            const text = document.createElement('div');
            text.className = 'message-text';
            text.textContent = message.text;
            content.appendChild(header);
            content.appendChild(text);
        }

        // Message actions (reply button)
        if (!isReply) {
            const actions = document.createElement('div');
            actions.className = 'message-actions';

            const replyBtn = document.createElement('button');
            replyBtn.className = 'message-action-btn';
            replyBtn.textContent = '💬';
            replyBtn.title = 'Reply in thread';
            replyBtn.addEventListener('click', () => {
                this.startReply(message.threadId);
            });

            actions.appendChild(replyBtn);
            messageDiv.appendChild(actions);
        }

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);

        return messageDiv;
    }

    private startReply(threadId: string): void {
        this.replyingToThread = threadId;
        this.elements.threadIndicator.style.display = 'flex';
        this.elements.messageInput.focus();
        this.elements.messageInput.placeholder = 'Reply to thread...';
    }

    private cancelReply(): void {
        this.replyingToThread = null;
        this.elements.threadIndicator.style.display = 'none';
        this.elements.messageInput.placeholder = 'Type your message here...';
    }

    private addMessage(text: string, sender: 'user' | 'assistant'): void {
        // Legacy method - convert to new message format
        this.addChatMessage({
            id: `msg-${Date.now()}`,
            text: text,
            author: sender === 'user' ? 'You' : 'OHERO Assistant',
            timestamp: new Date().toISOString(),
            threadId: (Date.now() / 1000).toString(),
            channel: this.currentChannel,
            isReply: false
        });
    }

    private addSystemMessage(text: string): void {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
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

        this.elements.messageInput.disabled = !connected;
        this.elements.sendButton.disabled = !connected;

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

            console.log('Requesting team channels...', requestMessage);
            this.websocket.send(JSON.stringify(requestMessage));
            this.addSystemMessage('Requesting team channels from server...');

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
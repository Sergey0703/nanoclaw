import { Channel, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';
export interface GmailChannelOpts {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, RegisteredGroup>;
}
export declare class GmailChannel implements Channel {
    name: string;
    private oauth2Client;
    private gmail;
    private opts;
    private pollIntervalMs;
    private pollTimer;
    private processedIds;
    private threadMeta;
    private consecutiveErrors;
    private userEmail;
    constructor(opts: GmailChannelOpts, pollIntervalMs?: number);
    connect(): Promise<void>;
    sendMessage(jid: string, text: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
    private buildQuery;
    private pollForMessages;
    private processMessage;
    private extractTextBody;
}
//# sourceMappingURL=gmail.d.ts.map
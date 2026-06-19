export interface UpIdentity {
  email: string;
  groups: string[];
  role: 'member' | 'admin';
}

export interface UpDocument {
  id: string;
  [key: string]: unknown;
}

export interface UpCollection<T extends Record<string, unknown>> {
  create(data: T): Promise<T & { id: string }>;
  get(id: string): Promise<T & { id: string }>;
  list(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ documents: Array<T & { id: string }> }>;
  update(id: string, data: T): Promise<T & { id: string }>;
  delete(id: string): Promise<{ deleted: true; id: string }>;
}

export interface UpChannel {
  connect(): WebSocket;
  on(
    type: string,
    listener: (message: { type: string; data?: unknown; sender?: string }) => void,
  ): () => void;
  send(type: string, data: unknown): void;
  close(): void;
}

export declare const up: {
  identity: { current(): Promise<UpIdentity> };
  db: { collection<T extends Record<string, unknown>>(name: string): UpCollection<T> };
  files: {
    put(name: string, file: Blob): Promise<{ name: string; size: number; url: string }>;
    get(name: string): Promise<Response>;
    list(): Promise<{
      files: Array<{ name: string; size: number; uploadedAt: string; contentType: string }>;
    }>;
    delete(name: string): Promise<{ deleted: true; name: string }>;
  };
  ai: {
    chat(
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    ): Promise<{ response?: string }>;
  };
  realtime: { channel(name: string): UpChannel };
};

export default up;

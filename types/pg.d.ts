declare module "pg" {
  export type ClientConfig = Record<string, unknown>;

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<T = unknown>(
      text: string,
      params?: ReadonlyArray<unknown>
    ): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  }
}


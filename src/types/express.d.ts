declare module 'swagger-jsdoc' {
  interface Options {
    definition?: {
      openapi?: string;
      info?: {
        title?: string;
        version?: string;
        description?: string;
        contact?: Record<string, string>;
      };
      servers?: Array<{ url: string; description?: string }>;
      [key: string]: unknown;
    };
    apis?: string[];
  }

  function swaggerJsdoc(options: Options): Record<string, unknown>;
  export default swaggerJsdoc;
  export type { Options };
}

/**
 * In-memory Prisma stand-in for the API regression specs.
 *
 * scripts/test-api.mjs swaps every `db/prisma` import for this file when it
 * bundles a spec, so no test can touch a database. Every `model.method(args)`
 * call is recorded in `__calls`; a spec overrides behaviour per model via
 * `__handlers[model][method]`. Unhandled reads return null / [] — assert on
 * recorded calls and sent messages, not only on "no error".
 *
 * Never imported by the API itself (the production bundle starts at main.ts).
 */
type Handler = (args: any) => unknown;

export interface FakePrisma {
  __calls: Array<{ model: string; method: string; args: any }>;
  __handlers: Record<string, Record<string, Handler>>;
  __reset(): void;
  [model: string]: any;
}

const calls: FakePrisma['__calls'] = [];
const handlers: FakePrisma['__handlers'] = {};
const delegates: Record<string, unknown> = {};

function delegate(model: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== 'string') return undefined;
        return async (args: any) => {
          calls.push({ model, method, args });
          const handler = handlers[model]?.[method];
          if (handler) return handler(args);
          switch (method) {
            case 'findMany':
              return [];
            case 'count':
              return 0;
            case 'updateMany':
            case 'deleteMany':
            case 'createMany':
              return { count: 0 };
            case 'create':
            case 'update':
            case 'upsert':
              return {
                id: `fake-${model}`,
                createdAt: new Date(),
                ...((args && (args.data || args.create)) || {}),
              };
            default:
              return null;
          }
        };
      },
    }
  );
}

const prisma: FakePrisma = new Proxy({} as FakePrisma, {
  get(_target, key) {
    if (typeof key !== 'string' || key === 'then') return undefined;
    if (key === '__calls') return calls;
    if (key === '__handlers') return handlers;
    if (key === '__reset') {
      return () => {
        calls.length = 0;
        for (const k of Object.keys(handlers)) delete handlers[k];
      };
    }
    if (key === '$transaction') {
      return async (x: unknown) =>
        typeof x === 'function' ? x(prisma) : Promise.all(x as Promise<unknown>[]);
    }
    if (key.startsWith('$')) return async () => undefined;
    return delegates[key] || (delegates[key] = delegate(key));
  },
});

export { prisma };
export default prisma;

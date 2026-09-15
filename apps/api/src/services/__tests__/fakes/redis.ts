/** No-op Redis stand-in for the API regression specs (see fakes/prisma.ts). */
const redis: any = new Proxy(
  {},
  {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (key === 'on') return () => redis;
      return async () => null;
    },
  }
);

export { redis };
export default redis;

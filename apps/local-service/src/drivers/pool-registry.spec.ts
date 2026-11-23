import { PoolRegistry } from './pool-registry';
import { makeProfile } from './test-helpers';

describe('PoolRegistry', () => {
  const close = jest.fn(async (_pool: { id: number }) => undefined);
  let counter = 0;
  const create = () => Promise.resolve({ id: ++counter });

  beforeEach(() => {
    close.mockClear();
    counter = 0;
  });

  it('reuses the pool while settings and password are unchanged', async () => {
    const registry = new PoolRegistry(close);
    const profile = makeProfile();

    const first = await registry.get(profile, 'secret', create);
    const second = await registry.get(profile, 'secret', create);

    expect(second).toBe(first);
    expect(close).not.toHaveBeenCalled();
  });

  it('shares a pending pool between concurrent callers', async () => {
    const registry = new PoolRegistry(close);
    const profile = makeProfile();

    const [a, b] = await Promise.all([
      registry.get(profile, null, create),
      registry.get(profile, null, create),
    ]);

    expect(a).toBe(b);
    expect(counter).toBe(1);
  });

  it('recreates the pool when the password changes', async () => {
    const registry = new PoolRegistry(close);
    const profile = makeProfile();

    const first = await registry.get(profile, 'old', create);
    const second = await registry.get(profile, 'new', create);

    expect(second).not.toBe(first);
    await new Promise((resolve) => setImmediate(resolve));
    expect(close).toHaveBeenCalledWith(first);
  });

  it('recreates the pool when connection settings change', async () => {
    const registry = new PoolRegistry(close);

    const first = await registry.get(makeProfile(), null, create);
    const second = await registry.get(
      makeProfile({ ssl_mode: 'require' }),
      null,
      create,
    );

    expect(second).not.toBe(first);
  });

  it('forgets a pool whose creation failed', async () => {
    const registry = new PoolRegistry(close);
    const profile = makeProfile();

    await expect(
      registry.get(profile, null, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(registry.get(profile, null, create)).resolves.toEqual({
      id: 1,
    });
  });

  it('closes pools on release and releaseAll', async () => {
    const registry = new PoolRegistry(close);

    const a = await registry.get(makeProfile({ id: 'a' }), null, create);
    const b = await registry.get(makeProfile({ id: 'b' }), null, create);

    await registry.release('a');
    expect(close).toHaveBeenCalledWith(a);

    await registry.releaseAll();
    expect(close).toHaveBeenCalledWith(b);
    expect(close).toHaveBeenCalledTimes(2);
  });
});

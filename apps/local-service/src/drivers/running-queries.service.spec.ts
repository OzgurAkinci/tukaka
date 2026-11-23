import { ConflictException } from '@nestjs/common';

import { RunningQueriesService } from './running-queries.service';

const ID = '11111111-1111-4111-8111-111111111111';

describe('RunningQueriesService', () => {
  let service: RunningQueriesService;

  beforeEach(() => {
    service = new RunningQueriesService();
  });

  it('reports unknown queries as not running', async () => {
    await expect(service.cancel(ID)).resolves.toMatchObject({
      cancelled: false,
      message: 'Query is not running.',
    });
  });

  it('invokes the registered cancel function', async () => {
    const handle = service.start(ID, 'conn', true);
    const cancel = jest.fn(async () => undefined);

    handle.setCancel(cancel);

    await expect(service.cancel(ID)).resolves.toMatchObject({ cancelled: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(handle.cancelRequested).toBe(true);
  });

  it('cancels as soon as the driver registers when requested early', async () => {
    const handle = service.start(ID, 'conn', true);
    const cancel = jest.fn(async () => undefined);

    await service.cancel(ID);
    expect(cancel).not.toHaveBeenCalled();

    handle.setCancel(cancel);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses for drivers without cancel support', async () => {
    service.start(ID, 'conn', false);

    await expect(service.cancel(ID)).resolves.toMatchObject({
      success: false,
      cancelled: false,
    });
  });

  it('forgets finished queries and rejects duplicate ids', async () => {
    const handle = service.start(ID, 'conn', true);

    expect(() => service.start(ID, 'conn', true)).toThrow(ConflictException);

    handle.finish();

    await expect(service.cancel(ID)).resolves.toMatchObject({ cancelled: false });
    expect(() => service.start(ID, 'conn', true).finish()).not.toThrow();
  });
});

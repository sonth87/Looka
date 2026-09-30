import { AiEditSlotGate } from './ai-edit-slot-gate';

describe('AiEditSlotGate', () => {
  it('never lets more than AI_EDIT_JOB_CONCURRENCY (3) acquires be held at once', async () => {
    const gate = new AiEditSlotGate();
    const r1 = await gate.acquire('background');
    const r2 = await gate.acquire('background');
    const r3 = await gate.acquire('user');

    let fourthResolved = false;
    const fourth = gate.acquire('user').then((release) => {
      fourthResolved = true;
      return release;
    });

    // Give any stray microtask a chance to resolve — it must not.
    await Promise.resolve();
    await Promise.resolve();
    expect(fourthResolved).toBe(false);

    r1();
    const r4 = await fourth;
    expect(fourthResolved).toBe(true);

    r2();
    r3();
    r4();
  });

  it('gives a freed slot to a waiting USER acquirer before a waiting BACKGROUND acquirer, regardless of arrival order', async () => {
    const gate = new AiEditSlotGate();
    const releases = await Promise.all([
      gate.acquire('user'),
      gate.acquire('user'),
      gate.acquire('user'),
    ]);

    const order: string[] = [];
    let backgroundResolved = false;
    const backgroundWaiter = gate.acquire('background').then((release) => {
      backgroundResolved = true;
      order.push('background');
      return release;
    });
    // Arrives AFTER the background waiter, but must still win the next slot.
    const userWaiter = gate.acquire('user').then((release) => {
      order.push('user');
      return release;
    });

    releases[0](); // frees exactly one slot

    const userRelease = await userWaiter;
    expect(order).toEqual(['user']);
    expect(backgroundResolved).toBe(false);

    userRelease();
    const backgroundRelease = await backgroundWaiter;
    expect(order).toEqual(['user', 'background']);

    releases[1]();
    releases[2]();
    backgroundRelease();
  });

  it('with capacity free, a USER acquire resolves immediately even while a BACKGROUND job is running', async () => {
    const gate = new AiEditSlotGate();
    const bgRelease = await gate.acquire('background');

    let userResolved = false;
    const userAcquire = gate.acquire('user').then((release) => {
      userResolved = true;
      return release;
    });
    await Promise.resolve();
    expect(userResolved).toBe(true);

    (await userAcquire)();
    bgRelease();
  });

  it('release is idempotent — calling it twice only frees one slot', async () => {
    const gate = new AiEditSlotGate();
    const releases = await Promise.all([
      gate.acquire('user'),
      gate.acquire('user'),
      gate.acquire('user'),
    ]);
    releases[0]();
    releases[0](); // second call must be a no-op

    let resolved = 0;
    const w1 = gate.acquire('user').then((r) => {
      resolved += 1;
      return r;
    });
    const w2 = gate.acquire('user').then((r) => {
      resolved += 1;
      return r;
    });
    await Promise.resolve();
    await Promise.resolve();
    // Only ONE slot was actually freed, so only one waiter should have
    // resolved — the double-release must not have freed a second slot.
    expect(resolved).toBe(1);

    releases[1]();
    releases[2]();
    const [w1Release, w2Release] = await Promise.all([w1, w2]);
    w1Release();
    w2Release();
  });

  it('rejectAllWaiters rejects only still-waiting acquirers, never ones already holding a slot', async () => {
    const gate = new AiEditSlotGate();
    const held = await Promise.all([
      gate.acquire('user'),
      gate.acquire('user'),
      gate.acquire('user'),
    ]);
    const waiting = gate.acquire('background');

    gate.rejectAllWaiters('test shutdown');

    await expect(waiting).rejects.toThrow('test shutdown');
    // The 3 already-held acquires were never touched.
    for (const release of held) release();
  });
});

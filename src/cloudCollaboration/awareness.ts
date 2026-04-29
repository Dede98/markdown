export type MockAwarenessState = Record<string, unknown>;

type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

type AwarenessListener = (change: AwarenessChange) => void;

export class MockAwarenessRoom {
  readonly states = new Map<number, MockAwarenessState>();
  private readonly awarenessClients = new Set<MockAwareness>();

  register(client: MockAwareness) {
    this.awarenessClients.add(client);
  }

  unregister(client: MockAwareness) {
    this.awarenessClients.delete(client);
    if (this.states.delete(client.doc.clientID)) {
      this.emit({ added: [], updated: [], removed: [client.doc.clientID] });
    }
  }

  setState(clientId: number, state: MockAwarenessState | null) {
    const existed = this.states.has(clientId);
    if (state === null) {
      if (this.states.delete(clientId)) {
        this.emit({ added: [], updated: [], removed: [clientId] });
      }
      return;
    }
    this.states.set(clientId, state);
    this.emit({
      added: existed ? [] : [clientId],
      updated: existed ? [clientId] : [],
      removed: [],
    });
  }

  emit(change: AwarenessChange) {
    for (const client of this.awarenessClients) {
      client.emit(change);
    }
  }
}

export class MockAwareness {
  readonly doc: { clientID: number };
  private readonly listeners = new Set<AwarenessListener>();

  constructor(
    private readonly room: MockAwarenessRoom,
    clientID: number,
  ) {
    this.doc = { clientID };
    this.room.register(this);
  }

  getLocalState() {
    return this.room.states.get(this.doc.clientID) ?? null;
  }

  getStates() {
    return this.room.states;
  }

  setLocalState(state: MockAwarenessState | null) {
    this.room.setState(this.doc.clientID, state);
  }

  setLocalStateField(field: string, value: unknown) {
    const next = { ...(this.getLocalState() ?? {}), [field]: value };
    this.setLocalState(next);
  }

  on(event: "change", listener: AwarenessListener) {
    if (event === "change") {
      this.listeners.add(listener);
    }
  }

  off(event: "change", listener: AwarenessListener) {
    if (event === "change") {
      this.listeners.delete(listener);
    }
  }

  emit(change: AwarenessChange) {
    for (const listener of this.listeners) {
      listener(change);
    }
  }

  destroy() {
    this.listeners.clear();
    this.room.unregister(this);
  }
}


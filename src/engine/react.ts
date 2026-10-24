'use client';
/**
 * Thin React binding. The only file in src/engine that imports React;
 * import it from '@/engine/react' (not from the core index).
 *
 *   const { engine, impact, sync, running, speed, store } = useLifelineEngine();
 *   store.start(60); store.approve(action.id); store.goOffline(); await store.goOnline();
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createEngineStore, type EngineStore, type EngineStoreOptions, type StoreSnapshot } from './store';

export interface UseLifelineEngine extends StoreSnapshot {
  store: EngineStore;
}

/** Subscribe to an existing store (e.g. one shared via context). */
export function useEngineStore(store: EngineStore): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Create a store for this component's lifetime and subscribe to it. Options are read once. */
export function useLifelineEngine(options?: EngineStoreOptions): UseLifelineEngine {
  const [store] = useState(() => createEngineStore(options));
  useEffect(() => () => store.destroy(), [store]);
  return { ...useEngineStore(store), store };
}

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

type RealtimeHandler<T = unknown> = (payload: T) => void;

export function useRealtimeEvents<T = unknown>(
  eventName: string,
  handler: RealtimeHandler<T>,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const url = import.meta.env.VITE_WS_URL;
    const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
    if (!enabled || !url || !token) return undefined;

    const socket: Socket = io(url, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on(eventName, (payload: T) => handlerRef.current(payload));

    return () => {
      socket.off(eventName);
      socket.close();
    };
  }, [enabled, eventName]);
}

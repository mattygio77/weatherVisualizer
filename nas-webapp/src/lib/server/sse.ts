import type { WeatherReading } from './meteorology';

type Client = {
  id: string;
  controller: ReadableStreamDefaultController;
};

const clients = new Map<string, Client>();

export function addSseClient(controller: ReadableStreamDefaultController): string {
  const id = Math.random().toString(36).substring(2) + Date.now().toString(36);
  clients.set(id, { id, controller });

  // Send initial ping
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`event: ping\ndata: {"time":${Math.floor(Date.now() / 1000)}}\n\n`));
  } catch {}

  return id;
}

export function removeSseClient(id: string) {
  clients.delete(id);
}

export function broadcastTelemetry(reading: WeatherReading) {
  if (clients.size === 0) return;

  const encoder = new TextEncoder();
  const payload = `event: weather\ndata: ${JSON.stringify(reading)}\n\n`;
  const encoded = encoder.encode(payload);

  for (const [id, client] of clients.entries()) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      clients.delete(id);
    }
  }
}

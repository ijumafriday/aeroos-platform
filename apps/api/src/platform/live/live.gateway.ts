import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { RawData, WebSocket } from 'ws';
import { TOPICS, type EventEnvelope } from '@aeroos/contracts';
import { CONFIG, type Config } from '../../config';
import type { Principal } from '../auth/principal';
import { TokenVerifier } from '../auth/token-verifier';
import { KafkaService } from '../events/kafka.service';

interface Session { principal: Principal | null; alive: boolean }

/**
 * Live updates to browsers. Each API replica runs its own Kafka consumer group and pushes every
 * new event to its connected, authenticated sockets for the same operator. Clients authenticate
 * with their access token in the first message (never in the URL, which ends up in logs).
 */
@WebSocketGateway({ path: '/ws' })
export class LiveGateway implements OnGatewayConnection, OnApplicationBootstrap {
  private readonly log = new Logger('Live');
  private readonly sessions = new Map<WebSocket, Session>();

  constructor(
    private readonly verifier: TokenVerifier,
    private readonly kafka: KafkaService,
    @Inject(CONFIG) private readonly config: Config
  ) {}

  async onApplicationBootstrap() {
    setInterval(() => this.heartbeat(), 25_000).unref();
    // Started in the background so a broker outage does not stop the API from serving HTTP.
    this.kafka.start(`live-${this.config.INSTANCE_ID}`, Object.values(TOPICS), async env => this.broadcast(env), { fromBeginning: false });
    this.log.log('live gateway ready on /ws');
  }

  handleConnection(client: WebSocket) {
    this.sessions.set(client, { principal: null, alive: true });
    const authTimeout = setTimeout(() => {
      if (!this.sessions.get(client)?.principal) client.close(4401, 'Authentication required');
    }, 10_000);
    client.on('pong', () => {
      const s = this.sessions.get(client);
      if (s) s.alive = true;
    });
    client.on('message', (raw: RawData) => void this.onMessage(client, raw));
    client.on('close', () => {
      clearTimeout(authTimeout);
      this.sessions.delete(client);
    });
  }

  private async onMessage(client: WebSocket, raw: RawData) {
    let msg: { type?: string; token?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'auth' && typeof msg.token === 'string') {
      try {
        const principal = await this.verifier.verify(msg.token);
        const s = this.sessions.get(client);
        if (s) s.principal = principal;
        client.send(JSON.stringify({ type: 'ready', operatorId: principal.operatorId }));
      } catch {
        client.close(4401, 'Invalid token');
      }
    }
  }

  broadcast(env: EventEnvelope) {
    const frame = JSON.stringify({ type: 'event', event: env });
    for (const [client, s] of this.sessions) {
      if (s.principal?.operators.includes(env.operatorId) && client.readyState === 1) client.send(frame);
    }
  }

  private heartbeat() {
    for (const [client, s] of this.sessions) {
      if (!s.alive) {
        client.terminate();
        this.sessions.delete(client);
        continue;
      }
      s.alive = false;
      client.ping();
    }
  }
}

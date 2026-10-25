import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { parseBranchScope, type AuthService } from '../auth/auth.service.js';
import { ACCESS_COOKIE, type TokenService } from '../auth/tokens.js';

export const SocketEvents = {
  FORCE_LOGOUT: 'auth:forceLogout',
  NOTIFICATION: 'notification:new',
  ATTENDANCE: 'attendance:event',
  SCHEDULE_PUBLISHED: 'schedule:published',
  SWAP_UPDATED: 'swap:updated',
  EMERGENCY: 'emergency:new',
  ACCOUNT_PENDING: 'account:pending',
  MAINTENANCE_UPDATED: 'system:maintenance',
} as const;

const rooms = {
  user: (id: string) => `user:${id}`,
  role: (role: string) => `role:${role}`,
  branch: (id: string) => `branch:${id}`,
  allBranches: 'branch:ALL',
};

/**
 * Socket.IO dùng chung process với API để phát sự kiện ngay sau khi ghi
 * Google Sheets thành công. Xác thực bằng cùng cookie access token.
 */
export class Realtime {
  readonly io: Server;

  constructor(app: FastifyInstance, tokens: TokenService, auth: AuthService, corsOrigin: string) {
    this.io = new Server(app.server, {
      path: '/socket.io',
      cors: {
        origin: (origin, callback) => {
          if (!origin || origin === corsOrigin || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost:')) {
            callback(null, true);
          } else {
            callback(null, corsOrigin);
          }
        },
        credentials: true,
      },
      serveClient: false,
    });

    this.io.use(async (socket, next) => {
      try {
        const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
        const authToken =
          typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
        const token = cookies[ACCESS_COOKIE] ?? authToken;
        if (!token) return next(new Error('UNAUTHORIZED'));
        const claims = await tokens.verifyAccess(token);
        const user = auth.resolveSession(claims);
        socket.data.userId = user.id;
        socket.data.role = user.role;
        socket.data.branchScope = parseBranchScope(user.branch_scope);
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      socket.join(rooms.user(socket.data.userId));
      socket.join(rooms.role(socket.data.role));
      const scope = socket.data.branchScope as 'ALL' | string[];
      if (scope === 'ALL') socket.join(rooms.allBranches);
      else for (const b of scope) socket.join(rooms.branch(b));
    });
  }

  /** Thu hồi phiên: đẩy sự kiện rồi ngắt mọi kết nối của user (FLOW-01). */
  forceLogout(userId: string, reason: string): void {
    const room = rooms.user(userId);
    this.io.to(room).emit(SocketEvents.FORCE_LOGOUT, { reason });
    this.io.in(room).disconnectSockets(true);
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.io.to(rooms.user(userId)).emit(event, payload);
  }

  toRole(role: string, event: string, payload: unknown): void {
    this.io.to(rooms.role(role)).emit(event, payload);
  }

  /** Gửi tới người phụ trách chi nhánh và người có phạm vi ALL. */
  toBranch(branchId: string, event: string, payload: unknown): void {
    this.io.to([rooms.branch(branchId), rooms.allBranches]).emit(event, payload);
  }

  /** Phát sự kiện toàn hệ thống tới mọi kết nối đang mở (Backoffice & Cổng NV). */
  broadcast(event: string, payload: unknown): void {
    this.io.emit(event, payload);
  }

  connectionCount(): number {
    return this.io.engine.clientsCount;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.io.close(() => resolve()));
  }
}

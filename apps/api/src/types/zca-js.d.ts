declare module 'zca-js' {
  export enum LoginQRCallbackEventType {
    QRCodeGenerated = 0,
    QRCodeExpired = 1,
    QRCodeScanned = 2,
    QRCodeDeclined = 3,
    GotLoginInfo = 4,
  }

  export enum ThreadType {
    User = 0,
    Group = 1,
  }

  export interface Credentials {
    imei: string;
    cookie: unknown;
    userAgent: string;
    language?: string;
  }

  export type LoginQRCallbackEvent =
    | {
        type: LoginQRCallbackEventType.QRCodeGenerated;
        data: { code: string; image: string; token: string };
        actions: { retry: () => unknown; abort: () => unknown };
      }
    | {
        type: LoginQRCallbackEventType.QRCodeExpired;
        data: null;
        actions: { retry: () => unknown; abort: () => unknown };
      }
    | {
        type: LoginQRCallbackEventType.QRCodeScanned;
        data: { avatar: string; display_name: string };
        actions: { retry: () => unknown; abort: () => unknown };
      }
    | {
        type: LoginQRCallbackEventType.QRCodeDeclined;
        data: { code: string };
        actions: { retry: () => unknown; abort: () => unknown };
      }
    | {
        type: LoginQRCallbackEventType.GotLoginInfo;
        data: Credentials;
        actions: null;
      };

  export interface API {
    getOwnId?: () => string;
    fetchAccountInfo: () => Promise<{
      profile?: {
        userId?: string;
        displayName?: string;
        zaloName?: string;
        phoneNumber?: string;
        avatar?: string;
      };
    }>;
    findUser: (phoneNumber: string) => Promise<{ uid?: string; display_name?: string; zalo_name?: string } | null>;
    sendMessage: (
      message: { msg: string } | string,
      threadId: string,
      type?: ThreadType,
    ) => Promise<{ message: { msgId: number } | null }>;
  }

  export class Zalo {
    constructor(options?: { logging?: boolean });
    login(credentials: Credentials): Promise<API>;
    loginQR(
      options?: { userAgent?: string; language?: string; qrPath?: string },
      callback?: (event: LoginQRCallbackEvent) => unknown,
    ): Promise<API>;
  }
}

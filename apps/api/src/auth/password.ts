import argon2 from 'argon2';

/** argon2id — tham số theo khuyến nghị OWASP. Không bao giờ lưu mật khẩu/PIN thô (SEC-03). */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Hash giả để so sánh khi tài khoản không tồn tại — tránh lộ thông tin qua thời gian phản hồi. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret('dummy-secret-for-timing-safety');
  return dummyHash;
}

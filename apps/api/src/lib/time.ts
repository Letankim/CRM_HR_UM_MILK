import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { ulid } from 'ulid';

dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_TZ = 'Asia/Ho_Chi_Minh';

/** Thời điểm hiện tại theo giờ server, định dạng ISO 8601 có offset +07:00. */
export function nowIso(): string {
  return dayjs().tz(APP_TZ).format('YYYY-MM-DDTHH:mm:ssZ');
}

export function todayLocal(): string {
  return dayjs().tz(APP_TZ).format('YYYY-MM-DD');
}

export function newId(): string {
  return ulid();
}

export { dayjs };

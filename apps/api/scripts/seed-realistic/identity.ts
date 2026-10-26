/**
 * Sinh danh tính cá nhân sát thực tế: họ tên theo giới tính, ngày sinh, CCCD 12 số (mã tỉnh 079 + mã giới tính/thế kỷ),
 * số điện thoại đúng đầu số nhà mạng, email, tài khoản ngân hàng, mã số thuế, địa chỉ và người liên hệ khẩn cấp.
 * Mọi giá trị duy nhất đều được đối chiếu với kho định danh (gồm dữ liệu đang có) trước khi dùng.
 */
import * as C from './catalog.js';
import { addDays, slugVi, type Rng, type UniquePool } from './kit.js';

export interface Person {
  fullName: string;
  lastName: string;
  givenName: string;
  gender: 'Nam' | 'Nữ';
  dob: string;
  phone: string;
  email: string;
  citizenId: string;
  citizenIssueDate: string;
  currentAddress: string;
  permanentAddress: string;
  emergencyName: string;
  emergencyPhone: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function genPhone(rng: Rng, pool: UniquePool): string {
  return pool.take('phone', () => `${rng.pick(C.MOBILE_PREFIXES)}${rng.digits(7)}`);
}

export function genPerson(rng: Rng, pool: UniquePool, birthYears: [number, number]): Person {
  const gender: Person['gender'] = rng.chance(0.56) ? 'Nữ' : 'Nam';
  const bank = gender === 'Nữ' ? C.FEMALE : C.MALE;
  const lastName = rng.pick(C.LAST_NAMES);
  let middle = '';
  let givenName = '';
  const fullName = pool.take('fullname', () => {
    middle = rng.pick(bank.middle);
    givenName = rng.pick(bank.given);
    return `${lastName} ${middle} ${givenName}`;
  });

  const year = rng.int(birthYears[0], birthYears[1]);
  const dob = `${year}-${pad2(rng.int(1, 12))}-${pad2(rng.int(1, 28))}`;
  const centuryGenderDigit = year >= 2000 ? (gender === 'Nam' ? 2 : 3) : (gender === 'Nam' ? 0 : 1);
  const citizenId = pool.take('cccd', () => `079${centuryGenderDigit}${String(year).slice(2)}${rng.digits(6)}`);
  const issueYear = Math.max(2021, year + 14);
  const citizenIssueDate = `${Math.min(issueYear, 2024)}-${pad2(rng.int(1, 12))}-${pad2(rng.int(1, 28))}`;

  const phone = genPhone(rng, pool);
  const email = pool.take('email', () => `${slugVi(givenName)}.${slugVi(lastName)}${String(year).slice(2)}${rng.int(1, 99)}@${rng.pick(C.EMAIL_DOMAINS)}`);

  const area = rng.pick(C.HCM_WARDS);
  const currentAddress = `${rng.int(12, 498)}/${rng.int(1, 40)} ${rng.pick(area.street)}, ${area.ward}, ${area.district}, TP. Hồ Chí Minh`;
  const hometown = rng.pick(C.HOMETOWNS);
  const permanentAddress = rng.chance(0.35) ? currentAddress : `Ấp ${rng.int(1, 6)}, Xã ${rng.pick(['Tân Phú', 'Bình Thạnh', 'An Hòa', 'Phước Lợi', 'Long Hưng', 'Mỹ Thạnh'])}, ${hometown}`;

  const parentIsFather = rng.chance(0.5);
  const emergencyName = `${lastName} ${parentIsFather ? 'Văn' : 'Thị'} ${rng.pick(C.PARENT_FIRST)} (${parentIsFather ? 'Bố' : 'Mẹ'})`;
  const emergencyPhone = genPhone(rng, pool);

  const bankDef = rng.pick(C.BANKS);
  const bankAccount = pool.take('bank', () => `${rng.int(1, 9)}${rng.digits(bankDef.len - 1)}`);
  const bankHolder = slugHolder(fullName);

  return { fullName, lastName, givenName, gender, dob, phone, email, citizenId, citizenIssueDate, currentAddress, permanentAddress, emergencyName, emergencyPhone, bankName: bankDef.name, bankAccount, bankHolder };
}

/** Tên chủ tài khoản ngân hàng: IN HOA, không dấu (đúng chuẩn in trên thẻ / sao kê). */
export function slugHolder(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();
}

export function genTaxCode(rng: Rng, pool: UniquePool): string {
  return pool.take('tax', () => `8${rng.digits(9)}`);
}

/** Ngày bắt đầu thử việc theo thâm niên: chính thức (2–14 tháng trước), thử việc (đang trong chu kỳ 12 ngày). */
export function hireDates(rng: Rng, today: string, stage: 'PROBATION' | 'OFFICIAL', cycleDays: number) {
  const start = stage === 'OFFICIAL' ? addDays(today, -rng.int(60, 420)) : addDays(today, -rng.int(2, 9));
  const end = addDays(start, cycleDays - 1);
  return { start, end, officialFrom: stage === 'OFFICIAL' ? addDays(end, 1) : '' };
}

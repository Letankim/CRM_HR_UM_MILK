'use client';

import { Alert, Space, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { evaluatePreScreenScores14, PRE_SCREEN_CRITERIA_14 } from '@umbm/shared';

interface CandidatePreScreenPaneProps {
  scores: Record<string, number>;
  onChangeScore: (key: string, points: number, rejectReason?: string) => void;
}

export function computeAutoPreScreenScoresFromValues(v: Record<string, unknown>): Record<string, number> {
  const fullName = String(v.full_name ?? '').trim();
  const birthYearStr = String(v.birth_year ?? '').trim();
  const birthMatch = birthYearStr.match(/(19\d{2}|20\d{2})/);
  const birthYear = birthMatch ? Number(birthMatch[1]) : 2004;
  const hometown = String(v.hometown ?? '').trim();
  const phone = String(v.phone ?? '').replace(/\D/g, '');
  const education = String(v.education ?? '').trim();
  const exp = `${String(v.experience_note ?? '')} ${String(v.fnb_skills ?? '')}`.trim();
  const source = String(v.source_channel ?? '').trim();
  const incident = String(v.incident_answer ?? '').trim();
  const fb = String(v.facebook_link ?? '').trim();

  const c1 = fullName.split(/\s+/).filter(Boolean).length >= 2 ? 1 : 0;
  const c2 = birthYear <= 2004 && birthYear >= 1980 ? 2 : birthYear >= 2005 && birthYear <= 2008 ? 1 : 0;
  const c3 = /hồ chí minh|tp\.?\s*hcm|sài gòn|bình dương|đồng nai|bà rịa|vũng tàu|tây ninh|bình phước|long an|tiền giang|bến tre|vĩnh long|trà vinh|đồng tháp|an giang|kiên giang|cần thơ|hậu giang|sóc trăng|bạc liêu|cà mau|miền nam|miền tây/i.test(hometown) ? 1 : 0;
  const c4 = /^0\d{9}$/.test(phone) ? 1 : 0;
  const c5 = /không đi học|chỉ đi làm|đã nghỉ học|đã tốt nghiệp|thpt|12\/12/i.test(education) ? 2 : education ? 1 : 0;
  const c6 = /pha chế|thu ngân|phục vụ|trà sữa|cà phê|f&b|barista|nhà hàng|quán/i.test(exp) ? 2 : exp && !/^(không|chưa|không có kinh nghiệm|chưa có kinh nghiệm|0|none)$/i.test(exp) ? 1 : 0;
  const c7 = /bạn bè|ban be|người quen|nguoi quen|giới thiệu|gioi thieu/i.test(source) ? -1 : 1;
  const c8 = /tự ý nghỉ|bỏ ca|nghỉ luôn|không cần báo|^bỏ trống$/i.test(incident) ? -1 : incident.length >= 3 ? 2 : 0;
  const c9 = /drama|châm biếm|tiêu cực/i.test(fb) ? -1 : (/facebook\.com\/[a-zA-Z0-9._-]+|fb\.com\/[a-zA-Z0-9._-]+/i.test(fb) && !/link ảo/i.test(fb) ? 2 : 1);

  return {
    full_name_valid: c1, age_valid: c2, hometown_cccd: c3, zalo_phone: c4,
    education_commitment: c5, fnb_experience: c6, source_channel_score: c7,
    incident_handling: c8, facebook_link: c9,
  };
}

export function CandidatePreScreenPane({ scores, onChangeScore }: CandidatePreScreenPaneProps) {
  const eval14 = evaluatePreScreenScores14(scores);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 12px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4 }}>
        <Space size={8} wrap>
          <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>Bảng chấm điểm sơ loại ứng viên (9 câu hỏi — Thang 14 điểm)</span>
          <span style={{ fontSize: 12, color: '#64748B' }}>Tích chọn trực tiếp hướng trả lời thực tế của ứng viên</span>
        </Space>
        <Space size={6} wrap>
          <Tag color={eval14.redFlagReason ? 'error' : eval14.qualified ? 'success' : 'warning'} icon={eval14.redFlagReason ? <CloseCircleOutlined /> : eval14.qualified ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />} style={{ margin: 0, fontWeight: 700, fontSize: 13, padding: '2px 10px' }}>
            Tổng điểm: {eval14.totalScore14}/14 điểm · {eval14.redFlagReason ? 'LOẠI TRỰC TIẾP' : eval14.qualified ? 'ĐẠT SƠ LOẠI (>= 8đ)' : 'DƯỚI 8 ĐIỂM (LOẠI)'}
          </Tag>
        </Space>
      </div>

      {eval14.redFlagReason && (
        <Alert type="error" showIcon message={`Ứng viên rơi vào tiêu chí LOẠI trực tiếp: ${eval14.redFlagReason}`} style={{ padding: '6px 12px' }} />
      )}

      <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#D97706', color: '#FFFFFF', fontWeight: 700, textAlign: 'center' }}>
              <th style={{ width: 44, padding: '7px 6px', borderRight: '1px solid #CBD5E1' }}>STT</th>
              <th style={{ width: '32%', padding: '7px 10px', borderRight: '1px solid #CBD5E1', textAlign: 'left' }}>Câu hỏi</th>
              <th style={{ padding: '7px 10px', borderRight: '1px solid #CBD5E1', textAlign: 'left' }}>Hướng trả lời (Tích chọn)</th>
              <th style={{ width: 95, padding: '7px 6px', borderRight: '1px solid #CBD5E1' }}>Thang điểm</th>
              <th style={{ width: 85, padding: '7px 6px' }}>Điểm đạt</th>
            </tr>
          </thead>
          <tbody>
            {PRE_SCREEN_CRITERIA_14.map((c) => {
              const curVal = Number(scores[c.key] ?? 0);
              return c.options.map((opt, idx) => {
                const isSelected = curVal === opt.points;
                return (
                  <tr
                    key={`${c.key}_${opt.key}`}
                    onClick={() => onChangeScore(c.key, opt.points, opt.rejectReason)}
                    style={{
                      borderTop: idx === 0 ? '1px solid #CBD5E1' : '1px dashed #E2E8F0',
                      background: isSelected ? (opt.isReject ? '#FEF08A' : '#EFF6FF') : (opt.isReject ? '#FEF9C3' : '#FFFFFF'),
                      cursor: 'pointer',
                    }}
                  >
                    {idx === 0 && (
                      <td rowSpan={c.options.length} style={{ textAlign: 'center', fontWeight: 700, borderRight: '1px solid #CBD5E1', padding: '6px', background: '#F8FAFC', color: '#0F172A' }}>
                        {c.stt}
                      </td>
                    )}
                    {idx === 0 && (
                      <td rowSpan={c.options.length} style={{ padding: '8px 10px', borderRight: '1px solid #CBD5E1', fontWeight: 600, color: '#0F172A', background: '#FFFFFF' }}>
                        {c.question}
                      </td>
                    )}
                    <td style={{ padding: '6px 10px', borderRight: '1px solid #CBD5E1', fontWeight: isSelected ? 700 : 400, color: opt.isReject ? '#B91C1C' : '#1E293B' }}>
                      <Space size={6}>
                        <input type="radio" checked={isSelected} readOnly style={{ accentColor: opt.isReject ? '#DC2626' : '#2563EB', cursor: 'pointer' }} />
                        <span>{opt.label}</span>
                      </Space>
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px', borderRight: '1px solid #CBD5E1', fontWeight: 700, color: opt.isReject ? '#B91C1C' : '#0F172A', background: opt.isReject ? '#FDE047' : 'transparent' }}>
                      {opt.isReject ? 'Loại' : opt.points}
                    </td>
                    {idx === 0 && (
                      <td rowSpan={c.options.length} style={{ textAlign: 'center', fontWeight: 700, padding: '6px', background: curVal < 0 ? '#FEE2E2' : '#F8FAFC', color: curVal < 0 ? '#DC2626' : '#2563EB', fontSize: 13 }}>
                        {curVal < 0 ? 'LOẠI' : `${curVal}đ`}
                      </td>
                    )}
                  </tr>
                );
              });
            })}
            <tr style={{ borderTop: '2px solid #94A3B8', background: '#E0F2FE', fontWeight: 700 }}>
              <td colSpan={3} rowSpan={3} style={{ padding: '8px 12px', borderRight: '1px solid #CBD5E1', color: '#0F172A', fontSize: 13 }}>
                MAXIMUM: 14 điểm · Đạt sơ loại: Từ 8 điểm trở lên · Dưới 8 điểm hoặc dính ô Vàng: Loại
              </td>
              <td style={{ textAlign: 'center', padding: '5px 6px', borderRight: '1px solid #CBD5E1', color: '#0F172A' }}>14 điểm</td>
              <td rowSpan={3} style={{ textAlign: 'center', padding: '6px', fontSize: 14, color: eval14.redFlagReason || !eval14.qualified ? '#DC2626' : '#16A34A', background: '#FFFFFF' }}>
                {eval14.redFlagReason ? 'LOẠI' : `${eval14.totalScore14}/14đ`}
              </td>
            </tr>
            <tr style={{ background: '#FCE7F3', fontWeight: 700, borderTop: '1px solid #CBD5E1' }}>
              <td style={{ textAlign: 'center', padding: '5px 6px', borderRight: '1px solid #CBD5E1', color: '#15803D' }}>8 điểm (Đạt)</td>
            </tr>
            <tr style={{ background: '#DBEAFE', fontWeight: 700, borderTop: '1px solid #CBD5E1' }}>
              <td style={{ textAlign: 'center', padding: '5px 6px', borderRight: '1px solid #CBD5E1', color: '#B91C1C' }}>dưới 8 điểm</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

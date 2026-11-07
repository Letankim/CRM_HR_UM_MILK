'use client';

import { Alert, Col, Row, Space, Tag } from 'antd';
import { CheckCircleFilled, CheckCircleOutlined, CloseCircleFilled, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>Bảng chấm điểm sơ loại hồ sơ ứng viên (9 câu hỏi — Thang 14 điểm)</div>
          <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>Bấm chọn trực tiếp phương án trả lời thực tế của ứng viên ở từng câu hỏi bên dưới</div>
        </div>
        <Tag
          color={eval14.redFlagReason ? 'error' : eval14.qualified ? 'success' : 'warning'}
          icon={eval14.redFlagReason ? <CloseCircleOutlined /> : eval14.qualified ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
          style={{ margin: 0, fontWeight: 700, fontSize: 13.5, padding: '5px 12px', borderRadius: 4 }}
        >
          Tổng điểm: {eval14.totalScore14}/14 điểm · {eval14.redFlagReason ? 'LOẠI TRỰC TIẾP' : eval14.qualified ? 'ĐẠT SƠ LOẠI (>= 8đ)' : 'DƯỚI 8 ĐIỂM (LOẠI)'}
        </Tag>
      </div>

      {eval14.redFlagReason && (
        <Alert type="error" showIcon message={`Ứng viên rơi vào tiêu chí LOẠI trực tiếp: ${eval14.redFlagReason}`} style={{ padding: '8px 14px' }} />
      )}

      <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden', background: '#FFFFFF' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '52px minmax(260px, 1.1fr) minmax(380px, 1.7fr) 104px', background: '#F1F5F9', borderBottom: '1px solid #E2E8F0', fontWeight: 700, fontSize: 13, color: '#0F172A' }}>
          <div style={{ padding: '10px 8px', textAlign: 'center', borderRight: '1px solid #E2E8F0' }}>STT</div>
          <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>Câu hỏi sơ loại</div>
          <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>Hướng trả lời & Thang điểm (Bấm chọn)</div>
          <div style={{ padding: '10px 8px', textAlign: 'center' }}>Điểm đạt</div>
        </div>

        {PRE_SCREEN_CRITERIA_14.map((c, idx) => {
          const curVal = Number(scores[c.key] ?? 0);
          const isRejected = curVal < 0;
          return (
            <div
              key={c.key}
              style={{
                display: 'grid', gridTemplateColumns: '52px minmax(260px, 1.1fr) minmax(380px, 1.7fr) 104px',
                borderBottom: idx < PRE_SCREEN_CRITERIA_14.length - 1 ? '1px solid #E2E8F0' : 'none',
                background: isRejected ? '#FFFBFB' : idx % 2 === 0 ? '#FFFFFF' : '#FCFDFE',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13.5, color: '#475569', borderRight: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {c.stt}
              </div>
              <div style={{ padding: '12px 14px', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: '#0F172A', lineHeight: 1.45 }}>{c.question}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>Điểm tối đa: {c.maxPoints} điểm</div>
              </div>
              <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                {c.options.map((opt) => {
                  const active = curVal === opt.points;
                  const borderColor = active ? (opt.isReject ? '#DC2626' : '#2563EB') : '#E2E8F0';
                  const bgColor = active ? (opt.isReject ? '#FEF2F2' : '#EFF6FF') : '#FFFFFF';
                  return (
                    <div
                      key={opt.key}
                      onClick={() => onChangeScore(c.key, opt.points, opt.rejectReason)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 4, border: `1px solid ${borderColor}`, background: bgColor,
                        cursor: 'pointer', transition: 'all 0.15s ease',
                      }}
                    >
                      <Space size={8} style={{ flex: 1 }}>
                        {active ? (
                          opt.isReject ? <CloseCircleFilled style={{ color: '#DC2626', fontSize: 15 }} /> : <CheckCircleFilled style={{ color: '#2563EB', fontSize: 15 }} />
                        ) : (
                          <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #94A3B8', background: '#FFFFFF' }} />
                        )}
                        <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: opt.isReject && active ? '#B91C1C' : '#0F172A', lineHeight: 1.4 }}>{opt.label}</span>
                      </Space>
                      <Tag color={opt.isReject ? 'error' : active ? 'blue' : 'default'} style={{ margin: 0, fontWeight: 700, minWidth: 56, textAlign: 'center' }}>
                        {opt.isReject ? 'LOẠI' : `${opt.points} điểm`}
                      </Tag>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 8px', background: isRejected ? '#FEF2F2' : '#F8FAFC' }}>
                <Tag color={isRejected ? 'error' : curVal === c.maxPoints ? 'success' : curVal > 0 ? 'blue' : 'default'} className="num" style={{ margin: 0, fontWeight: 700, fontSize: 13.5, padding: '4px 10px' }}>
                  {isRejected ? 'LOẠI' : `${curVal}/${c.maxPoints}đ`}
                </Tag>
              </div>
            </div>
          );
        })}
      </div>

      <Row gutter={[10, 10]}>
        <Col xs={12} md={6}><div style={{ padding: '10px 12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}><div style={{ fontSize: 11.5, color: '#64748B' }}>MAXIMUM (Tối đa)</div><div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginTop: 2 }}>14 điểm</div></div></Col>
        <Col xs={12} md={6}><div style={{ padding: '10px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4 }}><div style={{ fontSize: 11.5, color: '#15803D' }}>ĐẠT SƠ LOẠI</div><div style={{ fontSize: 15, fontWeight: 700, color: '#15803D', marginTop: 2 }}>Từ 8 điểm trở lên</div></div></Col>
        <Col xs={12} md={6}><div style={{ padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4 }}><div style={{ fontSize: 11.5, color: '#DC2626' }}>KHÔNG ĐẠT / LOẠI</div><div style={{ fontSize: 15, fontWeight: 700, color: '#DC2626', marginTop: 2 }}>Dưới 8 điểm / Dính LOẠI</div></div></Col>
        <Col xs={12} md={6}><div style={{ padding: '10px 12px', background: eval14.redFlagReason || !eval14.qualified ? '#FEF2F2' : '#EFF6FF', border: `1px solid ${eval14.redFlagReason || !eval14.qualified ? '#FECACA' : '#BFDBFE'}`, borderRadius: 4 }}><div style={{ fontSize: 11.5, color: '#475569' }}>KẾT QUẢ HIỆN TẠI</div><div style={{ fontSize: 15, fontWeight: 700, color: eval14.redFlagReason || !eval14.qualified ? '#DC2626' : '#2563EB', marginTop: 2 }}>{eval14.redFlagReason ? 'LOẠI TRỰC TIẾP' : `${eval14.totalScore14}/14đ (${eval14.qualified ? 'ĐẠT' : 'LOẠI'})`}</div></div></Col>
      </Row>
    </div>
  );
}

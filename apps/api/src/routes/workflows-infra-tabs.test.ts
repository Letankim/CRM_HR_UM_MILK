import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('Workflows, Infrastructure & Full Tab APIs (AI-INFRA-07..09, FLOW-02..04)', () => {
  it('enforces Probation OFF quota, 3-step Shift Swap (Saga only on Step 3), and Emergency Leave escalation', async () => {
    const { app, db, login, loginHeaders } = await buildTestApp('w');
    const hrHeaders = await loginHeaders('hr');

    const probEmp = db.employees.find((e) => e.stage === 'PROBATION')!;
    const offEmp = db.employees.find((e) => e.stage === 'OFFICIAL')!;
    const publishedAssign = db.shiftAssignments.find((a) => a.status === 'PUBLISHED')!;
    const origAssignee = publishedAssign.employee_id;
    const peerId = origAssignee === probEmp.id ? offEmp.id : probEmp.id;

    // 1. Leave OFF: probEmp (PROBATION) has 1 leave in seed; create leaves up to limit and verify next one throws OUT_OF_RANGE
    const currentUsed = db.leaveRequests.filter((l) => l.employee_id === probEmp.id).length;
    for (let i = currentUsed; i < 5; i++) {
      const okLeave = await app.inject({
        method: 'POST', url: '/api/admin/leave-requests', headers: hrHeaders,
        payload: { employee_id: probEmp.id, leave_date: `2026-10-${26 + i}`, shift_code: 'CA_SANG', reason: `Nghỉ phép ngày ${i + 1}` },
      });
      expect(okLeave.statusCode).toBe(201);
    }

    const overQuotaLeave = await app.inject({
      method: 'POST', url: '/api/admin/leave-requests', headers: hrHeaders,
      payload: { employee_id: probEmp.id, leave_date: '2026-11-02', shift_code: 'CA_SANG', reason: 'Vượt định mức thử việc' },
    });
    expect(overQuotaLeave.statusCode).toBe(400);
    expect(overQuotaLeave.json().errors.details[0].code).toBe('OUT_OF_RANGE');

    // 2. 3-Step Shift Swap: Step 1 & Step 2 MUST NOT mutate official SHIFT_ASSIGNMENTS
    const createSwap = await app.inject({
      method: 'POST', url: '/api/admin/shift-swaps', headers: hrHeaders,
      payload: { requester_id: origAssignee, peer_id: peerId, from_assignment_id: publishedAssign.id, reason: 'Đổi ca chiều sang đồng nghiệp' },
    });
    expect(createSwap.statusCode).toBe(201);
    const swapId = createSwap.json().data.id as string;
    expect(db.shiftAssignments.get(publishedAssign.id)?.employee_id).toBe(origAssignee);

    const swapListRes = await app.inject({ method: 'GET', url: '/api/admin/shift-swaps', headers: hrHeaders });
    expect(swapListRes.statusCode).toBe(200);
    expect(swapListRes.json().data[0].id).toBe(swapId);
    const { cookie: nvCookie } = await login('nv.thuviec', '246810', 'employee');
    const myAttRes = await app.inject({ method: 'GET', url: '/api/my-attendance', headers: { cookie: nvCookie, 'x-umbm-client': 'web' } });
    expect(myAttRes.statusCode).toBe(200);
    expect(myAttRes.json().data.swaps[0].id).toBe(swapId);

    const prematureApprove = await app.inject({
      method: 'POST', url: `/api/admin/shift-swaps/${swapId}/decide`, headers: hrHeaders,
      payload: { version: 1, decision: 'APPROVED', decision_reason: 'Duyệt sớm' },
    });
    expect(prematureApprove.statusCode).toBe(400);

    const peerAccept = await app.inject({
      method: 'POST', url: `/api/admin/shift-swaps/${swapId}/peer-respond`, headers: hrHeaders,
      payload: { version: 1, accept: true, peer_note: 'Tôi nhận ca thay' },
    });
    expect(peerAccept.statusCode).toBe(200);
    expect(db.shiftAssignments.get(publishedAssign.id)?.employee_id).toBe(origAssignee);

    const finalApprove = await app.inject({
      method: 'POST', url: `/api/admin/shift-swaps/${swapId}/decide`, headers: hrHeaders,
      payload: { version: 2, decision: 'APPROVED', decision_reason: 'Đủ định biên, duyệt đổi ca' },
    });
    expect(finalApprove.statusCode).toBe(200);
    expect(finalApprove.json().data.allowance_eligible).toBe(true);
    expect(db.shiftAssignments.get(publishedAssign.id)?.employee_id).toBe(peerId);

    // 3. Emergency Leave Escalation
    const seededEmg = db.emergencyLeaves.all()[0]!;
    const escalateRes = await app.inject({
      method: 'POST', url: `/api/admin/emergency-leaves/${seededEmg.id}/handle`, headers: hrHeaders,
      payload: { version: 1, action: 'ESCALATE', resolution_note: 'Không có người thay, chuyển cảnh báo lên HR' },
    });
    expect(escalateRes.statusCode).toBe(200);
    expect(escalateRes.json().data.status).toBe('ESCALATED');
    expect(escalateRes.json().data.escalated).toBe(true);
    await app.close();
  });

  it('enforces GPS Haversine radius, blocks gallery selfie uploads, and preserves raw attendance events on adjustment', async () => {
    const { app, db, loginHeaders } = await buildTestApp('v');
    const hrHeaders = await loginHeaders('hr');
    const publishedAssign = db.shiftAssignments.find((a) => a.status === 'PUBLISHED')!;
    const branch = db.branches.get(publishedAssign.branch_id)!;

    const galleryAttempt = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'GALLERY' },
    });
    expect(galleryAttempt.statusCode).toBe(400);

    const farGpsAttempt = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat + 0.05, lng: branch.lng + 0.05, selfie_source: 'LIVE_CAMERA' },
    });
    expect(farGpsAttempt.statusCode).toBe(400);
    expect(farGpsAttempt.json().errors.details[0].code).toBe('OUT_OF_RANGE');

    const validCheckIn = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'LIVE_CAMERA' },
    });
    expect(validCheckIn.statusCode).toBe(201);
    const rawEventCountBefore = db.attendanceEvents.all().length;

    const seededAdj = db.attendanceAdjustments.all()[0]!;
    const storeConfirm = await app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${seededAdj.id}/decide`, headers: hrHeaders,
      payload: { version: 1, action: 'STORE_CONFIRM', decision_reason: 'CH xác nhận nhân viên có làm hết ca' },
    });
    expect(storeConfirm.statusCode).toBe(200);
    expect(storeConfirm.json().data.status).toBe('STORE_CONFIRMED');

    const hrApprove = await app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${seededAdj.id}/decide`, headers: hrHeaders,
      payload: { version: 2, action: 'HR_APPROVE', decision_reason: 'HR duyệt bổ sung công' },
    });
    expect(hrApprove.statusCode).toBe(200);
    expect(hrApprove.json().data.status).toBe('APPROVED');
    expect(db.attendanceEvents.all().length).toBe(rawEventCountBefore);
    await app.close();
  });

  it('prevents 30-min interview slot conflicts, grades server-timed TEST attempts, and isolates MKT RBAC', async () => {
    const { app, db, loginHeaders } = await buildTestApp('u');
    const hrHeaders = await loginHeaders('hr');
    const adminHeaders = await loginHeaders('admin');
    const mktHeaders = await loginHeaders('mkt');

    const seededCand = db.candidates.all()[0]!;
    const seededIv = db.interviews.all()[0]!;
    const seededTestAsg = db.testAssignments.all()[0]!;
    const lockedPol = db.policies.find((p) => p.is_locked_policy)!;

    const createCand = await app.inject({
      method: 'POST', url: '/api/admin/candidates', headers: hrHeaders,
      payload: { full_name: 'Phạm Hồng Nhung', phone: '0901777888', applied_position: 'BARISTA', applied_branch_id: seededCand.branch_pref },
    });
    expect(createCand.statusCode).toBe(201);
    const newCandId = createCand.json().data.id as string;
    const filteredCands = await app.inject({
      method: 'GET', url: `/api/admin/candidates?branch_id=${seededCand.branch_pref}&status=NEW`, headers: hrHeaders,
    });
    expect(filteredCands.statusCode).toBe(200);
    expect(filteredCands.json().data.length).toBeGreaterThanOrEqual(1);

    // Chặn tạo thêm lịch phỏng vấn cho ứng viên đã có lịch (chỉ cho phép chỉnh sửa)
    const dupCandIv = await app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrHeaders, payload: { candidate_id: seededCand.id, interviewer_ids: ['hr'], scheduled_at: '2027-02-01T09:00:00+07:00' } });
    expect(dupCandIv.statusCode).toBe(400);
    expect(dupCandIv.json().errors.details[0].field).toBe('candidate_id');
    expect(dupCandIv.json().errors.details[0].code).toBe('DUPLICATE_VALUE');

    const conflictIv = await app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrHeaders, payload: { candidate_id: newCandId, interviewer_id: seededIv.interviewer_id, scheduled_at: seededIv.start_at } });
    expect(conflictIv.statusCode).toBe(400);
    expect(conflictIv.json().errors.details[0].code).toBe('DUPLICATE_VALUE');

    const pastIv = await app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrHeaders, payload: { candidate_id: newCandId, interviewer_ids: ['hr', 'store1'], scheduled_at: '2025-01-01T09:00:00+07:00' } });
    expect(pastIv.statusCode).toBe(400);
    expect(pastIv.json().errors.details[0].code).toBe('OUT_OF_RANGE');

    const validIv = await app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrHeaders, payload: { candidate_id: newCandId, interviewer_ids: ['hr', 'store1'], scheduled_at: '2027-01-15T10:00:00+07:00' } });
    expect(validIv.statusCode).toBe(201);
    const createdIvId = validIv.json().data.id as string;
    const ivNotif = db.notifications.find((n) => n.entity_type === 'INTERVIEWS' && n.entity_id === createdIvId);
    expect(ivNotif).toBeDefined();
    expect(ivNotif!.recipient_user_id.split(',')).toHaveLength(2);

    const editIv = await app.inject({
      method: 'PUT', url: `/api/admin/interviews/${createdIvId}/evaluate`, headers: hrHeaders,
      payload: { version: 1, interviewer_ids: ['hr', 'store1', 'admin'], scheduled_at: '2027-01-16T14:00:00+07:00', duration_minutes: 45, reschedule_requested: true, reschedule_reason: 'Dời sang chiều theo lịch ứng viên' },
    });
    expect(editIv.statusCode).toBe(200);
    const editNotifs = db.notifications.filter((n) => n.entity_type === 'INTERVIEWS' && n.entity_id === createdIvId);
    expect(editNotifs.length).toBe(2);
    expect(editNotifs[1]!.recipient_user_id.split(',')).toHaveLength(3);

    const startTest = await app.inject({ method: 'POST', url: `/api/tests/assignments/${seededTestAsg.id}/start`, headers: hrHeaders, payload: {} });
    expect(startTest.statusCode).toBe(201);
    const attemptId = startTest.json().data.id as string;

    const submitTest = await app.inject({ method: 'POST', url: `/api/tests/attempts/${attemptId}/submit`, headers: hrHeaders, payload: { version: 1, answers: { q1: 0, q2: 1 } } });
    expect(submitTest.statusCode).toBe(200);
    expect(submitTest.json().data.score_percent).toBe(100);
    expect(submitTest.json().data.passed).toBe(true);

    const blockedPol = await app.inject({ method: 'PUT', url: `/api/admin/policies/${lockedPol.id}`, headers: adminHeaders, payload: { version: 1, value_json: '15', owner_override_approved: false } });
    expect(blockedPol.statusCode).toBe(400);

    const mktAnc = await app.inject({
      method: 'POST', url: '/api/mkt/announcements', headers: mktHeaders,
      payload: {
        title: 'Bản tin MKT tháng 10', summary: 'Văn hóa nội bộ', body_md: 'Nội dung bản tin truyền thông nội bộ',
        status: 'DRAFT', audience_scope: 'STAGE', audience_target: 'THU_VIEC', cta_label: 'Xem SOP', cta_link: '/nv/ban-tin', requires_ack: true,
      },
    });
    expect(mktAnc.statusCode).toBe(201);
    expect(mktAnc.json().data.status).toBe('DRAFT');
    const ancId = mktAnc.json().data.id as string;

    // HR không được sửa bản tin do MKT tạo (Ownership-based Edit/Delete)
    const hrEditMktAnc = await app.inject({
      method: 'PUT', url: `/api/mkt/announcements/${ancId}`, headers: hrHeaders,
      payload: { version: 1, title: 'HR cố sửa bản tin MKT', summary: 'Test' },
    });
    expect(hrEditMktAnc.statusCode).toBe(403);

    // MKT phát hành bản tin sang SENT -> sinh DELIVERY_LOGS + Read Receipt + Retry (MKT-04, MKT-08)
    const publishAnc = await app.inject({
      method: 'PUT', url: `/api/mkt/announcements/${ancId}`, headers: mktHeaders,
      payload: { version: 1, title: 'Bản tin MKT chính thức', summary: 'Đã duyệt phát', status: 'SENT' },
    });
    expect(publishAnc.statusCode).toBe(200);
    expect(publishAnc.json().data.status).toBe('SENT');

    const ackRes = await app.inject({ method: 'POST', url: `/api/announcements/${ancId}/ack`, headers: hrHeaders, payload: {} });
    expect(ackRes.statusCode).toBe(200);

    const mediaRes = await app.inject({
      method: 'POST', url: '/api/mkt/media', headers: mktHeaders,
      payload: { file_name: 'banner-sop.png', mime_type: 'image/png', drive_file_id: '1DRV_MKT_01', is_internal_only: true },
    });
    expect(mediaRes.statusCode).toBe(201);

    const commsRes = await app.inject({ method: 'GET', url: '/api/mkt/comms', headers: mktHeaders });
    expect(commsRes.statusCode).toBe(200);
    expect(commsRes.json().data.audienceGroups.length).toBeGreaterThanOrEqual(3);
    expect(commsRes.json().data.deliveryLogs.length).toBeGreaterThan(0);

    // ADM-05 (Staffing Rules) & ADM-12 (System Settings + SEC-03 secret block) & FIN-10 (Revenue Labor Cost %)
    const ruleRes = await app.inject({
      method: 'POST', url: '/api/admin/staffing-rules', headers: adminHeaders,
      payload: { branch_id: 'ALL', shift_template_id: 'ALL', min_staff: 2, max_staff: 5, enforcement: 'HARD_BLOCK' },
    });
    expect(ruleRes.statusCode).toBe(201);

    const secretBlocked = await app.inject({
      method: 'PUT', url: '/api/admin/system-settings', headers: adminHeaders,
      payload: { key: 'GOOGLE_OAUTH_CLIENT_SECRET', value: 'hidden' },
    });
    expect(secretBlocked.statusCode).toBe(400);

    const mktPayrollForbidden = await app.inject({ method: 'GET', url: '/api/admin/payroll/items', headers: mktHeaders });
    expect(mktPayrollForbidden.statusCode).toBe(403);

    const mktAttendanceForbidden = await app.inject({ method: 'GET', url: '/api/admin/attendance', headers: mktHeaders });
    expect(mktAttendanceForbidden.statusCode).toBe(403);
    await app.close();
  });
});

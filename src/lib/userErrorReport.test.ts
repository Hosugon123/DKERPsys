import { describe, expect, it } from 'vitest';
import { buildUserErrorReport, formatUserErrorReport } from './userErrorReport';

describe('userErrorReport', () => {
  it('builds a user-facing report with context', () => {
    const report = buildUserErrorReport({
      title: '資料儲存失敗',
      message: '訂單數量格式錯誤',
      severity: 'warning',
      page: '訂單管理',
      action: '調整訂單貨量',
      field: '黑輪',
    });

    expect(report.title).toBe('資料儲存失敗');
    expect(report.message).toBe('訂單數量格式錯誤');
    expect(report.severity).toBe('warning');
    expect(report.page).toBe('訂單管理');
    expect(report.action).toBe('調整訂單貨量');
    expect(report.field).toBe('黑輪');
    expect(report.id).toBeTruthy();
    expect(report.occurredAt).toBeTruthy();
  });

  it('formats a copyable report for admin troubleshooting', () => {
    const text = formatUserErrorReport({
      id: 'test',
      title: '系統操作未完成',
      message: '無法送出盤點',
      severity: 'error',
      page: '攤上盤點',
      action: '完成攤上盤點',
      field: '米血',
      source: '登入帳號 dk002',
      occurredAt: '2026-07-26T12:00:00.000Z',
      url: 'https://dksys.vercel.app/',
      userAgent: 'iPhone Safari',
      technicalDetail: 'Error: failed',
    });

    expect(text).toContain('標題：系統操作未完成');
    expect(text).toContain('頁面：攤上盤點');
    expect(text).toContain('操作：完成攤上盤點');
    expect(text).toContain('欄位：米血');
    expect(text).toContain('技術資訊：');
  });
});

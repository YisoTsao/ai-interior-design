import { expect, test } from '@playwright/test';
import { newSampleProject } from './helpers';

/**
 * AI 渲染 UI（S5.10）端到端：真實 API＋worker（mock provider）＋ MinIO 預簽名上傳。
 * 註冊 → 3D → G-buffer 上傳 → 渲染（SSE 進度）→ 結果與比較 → 選取物件局部重繪。
 */
test('AI 渲染：登入、產生效果圖、比較、局部重繪', async ({ page }) => {
  test.setTimeout(180_000);
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

  await page.getByTestId('open-render').click();
  const panel = page.getByTestId('render-panel');
  await panel.getByTestId('auth-toggle').click();
  await panel.getByTestId('auth-email').fill(`ui${Date.now()}@test.local`);
  await panel.getByTestId('auth-password').fill('password-123');
  await panel.getByTestId('auth-submit').click();
  await expect(panel.getByTestId('render-balance')).toContainText('20');

  await panel.getByTestId('render-style').selectOption('scandinavian');
  await panel.getByTestId('render-extra').fill('午後陽光、淺色木地板');
  await expect(panel.getByTestId('render-submit')).toContainText('1');
  await panel.getByTestId('render-submit').click();
  await expect(panel.getByTestId('render-state')).toHaveAttribute('data-state', 'succeeded', {
    timeout: 60_000,
  });
  await expect(panel.getByTestId('render-result')).toHaveAttribute('data-render-state', 'succeeded');
  await expect(panel.getByTestId('render-image')).toBeVisible();
  await expect(panel.getByTestId('render-compare')).toBeVisible();
  await expect(panel.getByTestId('render-validation')).toContainText('0.8');
  await expect(panel.getByTestId('render-balance')).toContainText('19');
  await panel.screenshot({ path: 'e2e/results/render-panel.png' });

  // 4K 需確認才可送出（B6.2-5）
  await panel.getByText('4K', { exact: true }).click();
  await expect(panel.getByTestId('render-submit')).toBeDisabled();
  await panel.getByTestId('render-confirm4k').check();
  await expect(panel.getByTestId('render-submit')).toBeEnabled();
  await panel.getByText('1K', { exact: false }).first().click();

  // 局部重繪：在場景中選取沙發
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    const sofa = s.scene.levels[0].objects.find((o: any) => o.catalogId.startsWith('sofa'));
    s.select([sofa.id]);
  });
  await panel.getByTestId('inpaint-instruction').fill('墨綠色絨布沙發');
  await panel.getByTestId('inpaint-submit').click();
  // 等「局部重繪」本身的結果（避免讀到上一個渲染的 succeeded 狀態）
  const inpainted = panel.locator('[data-testid=render-result][data-kind=inpaint]');
  await expect(inpainted).toHaveAttribute('data-render-state', 'succeeded', { timeout: 60_000 });
  await expect(inpainted.getByTestId('render-image')).toBeVisible();
  await expect(panel.getByTestId('render-balance')).toContainText('18');
  await panel.screenshot({ path: 'e2e/results/render-inpaint.png' });
});

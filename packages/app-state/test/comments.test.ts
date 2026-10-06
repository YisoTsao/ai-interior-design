import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import {
  addComment,
  commentsOf,
  createEditorStore,
  deleteComment,
  replyComment,
  resolveComment,
} from '../src/index.js';

describe('comments', () => {
  it('新增、回覆、解決、刪除；場景仍合法；可 undo', () => {
    const store = createEditorStore();
    const s = store.getState();
    const c = addComment({
      levelId: s.levelId,
      position: [1000, 0, 2000],
      author: '設計師',
      text: '這裡改成落地窗？',
    });
    s.exec(c);
    s.exec(replyComment(c.commentId, '客戶', '好'));
    s.exec(resolveComment(c.commentId, true));
    let list = commentsOf(store.getState().scene);
    expect(list).toHaveLength(1);
    expect(list[0]!.replies[0]!.text).toBe('好');
    expect(list[0]!.resolved).toBe(true);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    store.getState().undo();
    expect(commentsOf(store.getState().scene)[0]!.resolved).toBe(false);
    store.getState().exec(deleteComment(c.commentId));
    list = commentsOf(store.getState().scene);
    expect(list).toHaveLength(0);
  });
});

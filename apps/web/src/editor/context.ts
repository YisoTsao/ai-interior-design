import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { EditorState, EditorActions, EditorStore } from '@interiorai/app-state';

export const EditorCtx = createContext<EditorStore | null>(null);
export function useEditorStore(): EditorStore {
  const s = useContext(EditorCtx);
  if (!s) throw new Error('EditorCtx missing');
  return s;
}
export function useEditor<T>(sel: (s: EditorState & EditorActions) => T): T {
  return useStore(useEditorStore(), sel);
}

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';

export interface PromptField {
  key: string;
  label: string;
  value: string;
  type?: 'text' | 'number';
}
interface Req {
  title: string;
  fields: PromptField[];
  resolve: (v: Record<string, string> | null) => void;
}

/** 通用輸入對話框（取代 window.prompt；遊戲 HUD 風格） */
export function usePrompt() {
  const [req, setReq] = useState<Req | null>(null);
  const ask = (title: string, fields: PromptField[]) =>
    new Promise<Record<string, string> | null>((resolve) => setReq({ title, fields, resolve }));
  const node = req ? <PromptDialog req={req} onDone={() => setReq(null)} /> : null;
  return { ask, node };
}

function PromptDialog({ req, onDone }: { req: Req; onDone: () => void }) {
  const { t } = useTranslation();
  const [vals, setVals] = useState(() => Object.fromEntries(req.fields.map((f) => [f.key, f.value])));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.select(), []);
  const close = (ok: boolean) => {
    req.resolve(ok ? vals : null);
    onDone();
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="game-ui hud-panel fixed top-1/3 left-1/2 z-50 w-80 -translate-x-1/2 space-y-3 p-4"
          aria-describedby={undefined}
          data-testid="prompt-dialog"
        >
          <Dialog.Title className="hud-title">{req.title}</Dialog.Title>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            {req.fields.map((f, i) => (
              <label key={f.key} className="grid gap-1 text-xs">
                <span>{f.label}</span>
                <input
                  ref={i === 0 ? first : undefined}
                  className="field"
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={vals[f.key] ?? ''}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                  data-testid={`prompt-${f.key}`}
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn" onClick={() => close(false)}>
                {t('upload.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" data-testid="prompt-ok">
                {t('prompt.ok')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

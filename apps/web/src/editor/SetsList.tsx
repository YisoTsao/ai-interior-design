import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { activeLevel, FURNITURE_SETS, placeSet, type FurnitureSet } from '@interiorai/app-state';
import { detectRooms, type Vec2 } from '@interiorai/core-geometry';
import { catalog } from '../catalogData';
import { useEditorStore } from './context';
import { useThumbnail } from './thumbs';
import { dragPayload } from './dragPayload';

/** 套組放置點：選取的房間中心 → 最大房間中心 → 原點 */
function targetPoint(level: ReturnType<typeof activeLevel>, selection: string[]): Vec2 {
  const det = detectRooms(level).rooms;
  const sel = level.rooms.find((r) => selection.includes(r.id));
  const key = sel ? [...sel.wallIds].sort().join('|') : null;
  const room =
    (key && det.find((d) => d.key === key)) ||
    det.reduce<(typeof det)[number] | null>((a, b) => (!a || b.netArea > a.netArea ? b : a), null);
  if (!room) return [0, 0];
  const n = room.floor.length;
  return [
    Math.round(room.floor.reduce((s, p) => s + p[0], 0) / n),
    Math.round(room.floor.reduce((s, p) => s + p[1], 0) / n),
  ];
}

export function placeSetAt(store: ReturnType<typeof useEditorStore>, set: FurnitureSet, at?: Vec2) {
  const s = store.getState();
  const cmd = placeSet(s.levelId, set, at ?? targetPoint(activeLevel(s), s.selection));
  if (s.exec(cmd)) s.select(cmd.ids);
}

/** 家具套組（FE-AST-06）：點擊放到選取房間／最大房間中央，或拖到 2D／3D 指定位置；放置後為同一群組 */
export function SetsList() {
  const { t } = useTranslation();
  const store = useEditorStore();
  return (
    <ul className="grid grid-cols-2 gap-2" data-testid="sets-list">
      {FURNITURE_SETS.map((set) => (
        <SetCard key={set.id} set={set} onPick={() => placeSetAt(store, set)} label={t(`sets.${set.id}`)} />
      ))}
    </ul>
  );
}

function SetCard({ set, onPick, label }: { set: FurnitureSet; onPick: () => void; label: string }) {
  const { t } = useTranslation();
  const main = catalog.get(set.items[0]!.catalogId);
  const thumb = useThumbnail(main);
  const price = set.items.reduce((s, it) => s + (catalog.get(it.catalogId)?.unitPriceTwd ?? 0), 0);
  return (
    <li>
      <button
        className="inv-slot h-full w-full"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-interiorai-set', set.id);
          dragPayload.start({ kind: 'set', id: set.id });
        }}
        onDragEnd={dragPayload.end}
        onClick={onPick}
        data-testid={`set-${set.id}`}
        aria-label={t('sets.place', { name: label })}
      >
        <span className="inv-badge" aria-hidden>
          <Layers size={10} className="inline" aria-hidden /> {t('sets.badge', { n: set.items.length })}
        </span>
        <span className="inv-thumb" aria-hidden>
          {thumb ? (
            <img src={thumb} alt="" draggable={false} />
          ) : (
            <span className="h-8 w-8 animate-pulse bg-border" />
          )}
        </span>
        <span className="line-clamp-1 text-xs font-medium">{label}</span>
        <span className="inv-price text-[11px]">{t('assets.price', { n: price.toLocaleString() })}</span>
      </button>
    </li>
  );
}

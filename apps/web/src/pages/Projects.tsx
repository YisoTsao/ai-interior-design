import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { FilePlus2, LayoutTemplate, Trash2, Upload } from 'lucide-react';
import {
  createEditorStore,
  deleteProject,
  listProjects,
  saveProject,
  type ProjectSummary,
} from '@interiorai/app-state';
import { buildSampleScene } from '../sample';
import { LangToggle, OfflineBadge } from '../editor/common';

export function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const refresh = () => listProjects().then(setItems);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async (sample: boolean) => {
    const s = createEditorStore();
    const scene = sample
      ? buildSampleScene({
          living: t('projects.sampleRooms.living'),
          bed1: t('projects.sampleRooms.bed1'),
          bed2: t('projects.sampleRooms.bed2'),
        })
      : s.getState().scene;
    const id = s.getState().projectId;
    await saveProject({ id, name: sample ? t('projects.sampleName') : t('projects.untitled'), scene });
    void nav(`/p/${id}/edit`);
  };

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('projects.title')}</h1>
        <OfflineBadge />
        <div className="ml-auto flex gap-2">
          <LangToggle />
          <button className="btn" disabled title={t('projects.importSoon')}>
            <Upload size={16} aria-hidden /> {t('projects.importSoon')}
          </button>
          <button className="btn" onClick={() => create(true)} data-testid="new-sample">
            <LayoutTemplate size={16} aria-hidden /> {t('projects.sample')}
          </button>
          <button className="btn btn-primary" onClick={() => create(false)} data-testid="new-project">
            <FilePlus2 size={16} aria-hidden /> {t('projects.new')}
          </button>
        </div>
      </header>
      {items === null ? (
        <ul className="grid grid-cols-3 gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border p-16 text-center">
          <p className="text-muted">{t('projects.empty')}</p>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => create(false)}>
              {t('projects.new')}
            </button>
            <button className="btn" onClick={() => create(true)}>
              {t('projects.sample')}
            </button>
          </div>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="project-list">
          {items.map((p) => (
            <li key={p.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <Link to={`/p/${p.id}/edit`} className="block font-medium hover:underline">
                {p.name || t('projects.untitled')}
              </Link>
              <p className="mt-1 text-xs text-muted">
                {t('projects.stats', { walls: p.wallCount, objects: p.objectCount })}
              </p>
              <p className="text-xs text-muted">
                {t('projects.updated', { time: new Date(p.updatedAt).toLocaleString(i18n.language) })}
              </p>
              <div className="mt-3 flex gap-2">
                <Link to={`/p/${p.id}/edit`} className="btn btn-primary">
                  {t('projects.open')}
                </Link>
                <button
                  className="btn"
                  onClick={async () => {
                    if (window.confirm(t('projects.confirmDelete', { name: p.name }))) {
                      await deleteProject(p.id);
                      void refresh();
                    }
                  }}
                >
                  <Trash2 size={14} aria-hidden /> {t('projects.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

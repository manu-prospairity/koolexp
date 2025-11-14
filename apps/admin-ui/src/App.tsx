import { useEffect, useMemo, useState } from 'react';

type Page = {
  id: string;
  title: string;
  path: string;
  locale: string;
  status: string;
  updatedAt: string;
};

type ReleaseSummary = {
  id: string;
  name?: string | null;
  notes?: string | null;
  status: string;
  publicationId?: string | null;
  lastSubmittedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  pageCount: number;
};

const authoringUrl = import.meta.env.VITE_AUTHORING_URL ?? 'http://localhost:4101';
const deliveryUrl = import.meta.env.VITE_DELIVERY_URL ?? 'http://localhost:4104';
const apiKey = import.meta.env.VITE_API_KEY;

const authHeaders = apiKey ? { 'x-api-key': apiKey } : {};

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

const StatusBadge = ({ status }: { status: string }) => (
  <span className="badge" style={{ textTransform: 'capitalize' }}>
    {status.toLowerCase()}
  </span>
);

export default function App() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [releaseName, setReleaseName] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [submittingRelease, setSubmittingRelease] = useState(false);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [deliveryPath, setDeliveryPath] = useState('');
  const [deliveryLocale, setDeliveryLocale] = useState('');
  const [deliveryResult, setDeliveryResult] = useState<unknown>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const hasSelection = selectedPageIds.size > 0;

  const hydratePages = async () => {
    setLoadingPages(true);
    try {
      const data = await apiFetch<Page[]>(`${authoringUrl}/v1/pages`);
      setPages(data);
      if (data.length && selectedPageIds.size === 0) {
        setSelectedPageIds(new Set([data[0].id]));
      }
    } catch (error) {
      console.error('Failed to load pages', error);
    } finally {
      setLoadingPages(false);
    }
  };

  const hydrateReleases = async () => {
    try {
      const data = await apiFetch<ReleaseSummary[]>(`${authoringUrl}/v1/releases`);
      setReleases(data);
    } catch (error) {
      console.error('Failed to load releases', error);
    }
  };

  useEffect(() => {
    void hydratePages();
    void hydrateReleases();
  }, []);

  const togglePageSelection = (id: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedPages = useMemo(
    () => pages.filter((page) => selectedPageIds.has(page.id)),
    [pages, selectedPageIds]
  );

  const submitRelease = async () => {
    if (!hasSelection) {
      setReleaseError('Select at least one page');
      return;
    }
    setSubmittingRelease(true);
    setReleaseError(null);
    try {
      await apiFetch(`${authoringUrl}/v1/releases`, {
        method: 'POST',
        body: JSON.stringify({
          pageIds: Array.from(selectedPageIds),
          name: releaseName || undefined,
          notes: releaseNotes || undefined
        })
      });
      setReleaseName('');
      setReleaseNotes('');
      await hydrateReleases();
    } catch (error: unknown) {
      setReleaseError(error instanceof Error ? error.message : 'Failed to submit release');
    } finally {
      setSubmittingRelease(false);
    }
  };

  const fetchDelivery = async () => {
    setDeliveryError(null);
    setDeliveryResult(null);
    try {
      const url = new URL('/v1/delivery/pages/by-path', deliveryUrl);
      url.searchParams.set('path', deliveryPath);
      url.searchParams.set('locale', deliveryLocale);
      const data = await apiFetch(url.toString(), { method: 'GET', headers: authHeaders });
      setDeliveryResult(data);
    } catch (error: unknown) {
      setDeliveryError(error instanceof Error ? error.message : 'Failed to fetch delivery');
    }
  };

  return (
    <main>
      <header style={{ marginBottom: '2rem' }}>
        <h1>DXP Admin Console</h1>
        <p>Manage drafts, orchestrate releases, and inspect published pages.</p>
      </header>

      <section>
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Draft Pages</h2>
          <button onClick={hydratePages} disabled={loadingPages}>
            Refresh
          </button>
        </div>
        <p>Select the pages you want to bundle into a release.</p>
        <div className="table-grid">
          {pages.map((page) => (
            <label key={page.id} className="card" style={{ display: 'block', cursor: 'pointer' }}>
              <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>{page.title}</h3>
                <input
                  type="checkbox"
                  checked={selectedPageIds.has(page.id)}
                  onChange={() => togglePageSelection(page.id)}
                />
              </div>
              <p style={{ margin: '0.25rem 0' }}>{page.path}</p>
              <div className="flex" style={{ alignItems: 'center' }}>
                <StatusBadge status={page.status} />
                <small>{page.locale}</small>
              </div>
              <small>Updated {formatDate(page.updatedAt)}</small>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Request Release</h2>
        <p>Bundle the selected pages into a release request.</p>
        <input
          placeholder="Release name (optional)"
          value={releaseName}
          onChange={(event) => setReleaseName(event.target.value)}
        />
        <textarea
          placeholder="Notes"
          value={releaseNotes}
          onChange={(event) => setReleaseNotes(event.target.value)}
          rows={3}
        />
        <button onClick={submitRelease} disabled={!hasSelection || submittingRelease}>
          {submittingRelease ? 'Submitting…' : `Submit Release (${selectedPages.length} pages)`}
        </button>
        {releaseError ? <p style={{ color: '#b91c1c' }}>{releaseError}</p> : null}
      </section>

      <section>
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Release History</h2>
          <button onClick={hydrateReleases}>Refresh</button>
        </div>
        <div className="table-grid">
          {releases.map((release) => (
            <div key={release.id} className="card">
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <h3>{release.name ?? 'Untitled release'}</h3>
                <StatusBadge status={release.status} />
              </div>
              <p style={{ margin: '0.2rem 0', color: '#64748b' }}>{release.notes ?? 'No notes'}</p>
              <small>Pages: {release.pageCount}</small>
              <br />
              <small>Requested: {formatDate(release.createdAt)}</small>
              <br />
              <small>Last submitted: {formatDate(release.lastSubmittedAt)}</small>
              {release.errorMessage ? (
                <p style={{ color: '#b45309' }}>Error: {release.errorMessage}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Delivery Inspector</h2>
        <div className="flex" style={{ gap: '1rem' }}>
          <input
            placeholder="Page path (e.g. /products/home)"
            value={deliveryPath}
            onChange={(event) => setDeliveryPath(event.target.value)}
          />
          <input
            placeholder="Locale (e.g. en-AU)"
            value={deliveryLocale}
            onChange={(event) => setDeliveryLocale(event.target.value)}
          />
        </div>
        <button onClick={fetchDelivery} disabled={!deliveryPath || !deliveryLocale}>
          Fetch published page
        </button>
        {deliveryError ? <p style={{ color: '#b91c1c' }}>{deliveryError}</p> : null}
        {deliveryResult ? (
          <pre style={{ background: '#0f172a', color: '#f1f5f9', padding: '1rem', borderRadius: '10px' }}>
            {JSON.stringify(deliveryResult, null, 2)}
          </pre>
        ) : null}
      </section>
    </main>
  );
}

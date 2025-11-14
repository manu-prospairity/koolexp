import crypto from 'crypto';
import { promises as fsp } from 'fs';
import path from 'path';

export type PageEntry = {
  id: string;
  path: string;
  locale: string;
  title: string;
  components: unknown;
  seo?: unknown;
};

export type StoredReleaseStatus = 'created' | 'promoted' | 'rolledback';

export type StoredRelease = {
  id: string;
  status: StoredReleaseStatus;
  createdAt: string;
  promotedAt?: string;
  rolledBackAt?: string;
  name?: string;
  notes?: string;
  pages: PageEntry[];
};

type CreateReleasePayload = {
  name?: string;
  notes?: string;
  pages: PageEntry[];
};

type ReleaseFilter = {
  status?: StoredReleaseStatus;
  search?: string;
};

type ReleaseState = {
  releases: StoredRelease[];
};

const DELIVERY_INDEX = 'index.json';

export class JournalReleaseStore {
  private loaded = false;
  private state: ReleaseState = { releases: [] };

  constructor(
    private readonly storeFile: string,
    private readonly deliveryDir: string
  ) {}

  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }
    try {
      const payload = await fsp.readFile(this.storeFile, 'utf-8');
      this.state = JSON.parse(payload) as ReleaseState;
    } catch {
      await fsp.mkdir(path.dirname(this.storeFile), { recursive: true });
      this.state = { releases: [] };
      await this.persist();
    }
    this.loaded = true;
  }

  private async persist() {
    await fsp.writeFile(this.storeFile, JSON.stringify(this.state, null, 2));
  }

  async create(payload: CreateReleasePayload): Promise<StoredRelease> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const release: StoredRelease = {
      id: crypto.randomUUID(),
      status: 'created',
      createdAt: now,
      name: payload.name,
      notes: payload.notes,
      pages: payload.pages
    };
    this.state.releases.push(release);
    await this.persist();
    return release;
  }

  async read(id: string): Promise<StoredRelease> {
    await this.ensureLoaded();
    const release = this.state.releases.find((r) => r.id === id);
    if (!release) {
      throw new Error(`Release ${id} not found`);
    }
    return release;
  }

  async list(filter?: ReleaseFilter): Promise<StoredRelease[]> {
    await this.ensureLoaded();
    return this.state.releases
      .filter((release) => {
        if (filter?.status && release.status !== filter.status) {
          return false;
        }
        if (filter?.search) {
          const needle = filter.search.toLowerCase();
          const matchesMetadata =
            (release.name?.toLowerCase().includes(needle) ?? false) ||
            (release.notes?.toLowerCase().includes(needle) ?? false);
          const matchesPage = release.pages.some((page) => page.path.toLowerCase().includes(needle));
          return matchesMetadata || matchesPage;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async promote(id: string): Promise<StoredRelease> {
    await this.ensureLoaded();
    const release = await this.read(id);
    release.status = 'promoted';
    release.promotedAt = new Date().toISOString();
    release.rolledBackAt = undefined;
    await this.persist();
    await this.persistToDelivery(release);
    return release;
  }

  async rollback(id: string): Promise<StoredRelease> {
    await this.ensureLoaded();
    const release = await this.read(id);
    release.status = 'rolledback';
    release.rolledBackAt = new Date().toISOString();
    await this.persist();
    return release;
  }

  async summary() {
    await this.ensureLoaded();
    const summary: Record<StoredReleaseStatus, number> = {
      created: 0,
      promoted: 0,
      rolledback: 0
    };
    this.state.releases.forEach((release) => {
      summary[release.status] += 1;
    });
    return summary;
  }

  async getDeliverySnapshot(releaseId?: string): Promise<StoredRelease | null> {
    await this.ensureLoaded();
    if (releaseId) {
      try {
        return await this.read(releaseId);
      } catch {
        return null;
      }
    }
    const active = await this.readActiveReleaseId();
    if (!active) {
      return null;
    }
    return this.read(active).catch(() => null);
  }

  private async persistToDelivery(release: StoredRelease) {
    const releasesDir = path.join(this.deliveryDir, 'releases');
    await fsp.mkdir(releasesDir, { recursive: true });
    const filePath = path.join(releasesDir, `${release.id}.json`);
    await fsp.writeFile(filePath, JSON.stringify(release, null, 2));

    const indexPath = path.join(this.deliveryDir, DELIVERY_INDEX);
    await fsp.writeFile(
      indexPath,
      JSON.stringify(
        {
          activeReleaseId: release.id,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  }

  private async readActiveReleaseId() {
    const indexPath = path.join(this.deliveryDir, DELIVERY_INDEX);
    try {
      const payload = await fsp.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(payload) as { activeReleaseId?: string };
      return parsed.activeReleaseId ?? null;
    } catch {
      return null;
    }
  }
}

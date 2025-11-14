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

type ReleaseFilter = {
  status?: StoredReleaseStatus;
  search?: string;
};

type CreateReleasePayload = {
  name?: string;
  notes?: string;
  pages: PageEntry[];
};

const DELIVERY_RELEASES_DIR = 'releases';
const DELIVERY_INDEX_FILE = 'index.json';

export class FileReleaseStore {
  constructor(private readonly releasesDir: string, private readonly deliveryDir: string) {}

  private releaseFilePath(id: string) {
    return path.join(this.releasesDir, `${id}.json`);
  }

  private async writeRelease(release: StoredRelease) {
    const filePath = this.releaseFilePath(release.id);
    await fsp.writeFile(filePath, JSON.stringify(release, null, 2));
  }

  async create(payload: CreateReleasePayload): Promise<StoredRelease> {
    const now = new Date().toISOString();
    const release: StoredRelease = {
      id: crypto.randomUUID(),
      status: 'created',
      createdAt: now,
      name: payload.name,
      notes: payload.notes,
      pages: payload.pages
    };

    await this.writeRelease(release);
    return release;
  }

  async read(id: string): Promise<StoredRelease> {
    const filePath = this.releaseFilePath(id);
    const payload = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(payload) as StoredRelease;
  }

  async list(filter?: ReleaseFilter): Promise<StoredRelease[]> {
    const files = await fsp.readdir(this.releasesDir);
    const releases = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.read(path.basename(file, '.json')))
    );

    return releases
      .filter((release) => {
        if (filter?.status && release.status !== filter.status) {
          return false;
        }
        if (filter?.search) {
          const needle = filter.search.toLowerCase();
          return (
            release.name?.toLowerCase().includes(needle) ||
            release.notes?.toLowerCase().includes(needle) ||
            release.pages.some((page) => page.path.toLowerCase().includes(needle))
          );
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async promote(id: string): Promise<StoredRelease> {
    const release = await this.read(id);
    const promoted: StoredRelease = {
      ...release,
      status: 'promoted',
      promotedAt: new Date().toISOString(),
      rolledBackAt: undefined
    };
    await this.writeRelease(promoted);
    await this.persistToDelivery(promoted);
    return promoted;
  }

  async rollback(id: string): Promise<StoredRelease> {
    const release = await this.read(id);
    const rolledBack: StoredRelease = {
      ...release,
      status: 'rolledback',
      rolledBackAt: new Date().toISOString()
    };
    await this.writeRelease(rolledBack);
    return rolledBack;
  }

  async getDeliveryRelease(releaseId?: string): Promise<StoredRelease | null> {
    const targetId = releaseId ?? (await this.readActiveReleaseId());
    if (!targetId) {
      return null;
    }

    try {
      return this.readFromDelivery(targetId);
    } catch {
      return null;
    }
  }

  private async persistToDelivery(release: StoredRelease) {
    const deliveryReleasesDir = path.join(this.deliveryDir, DELIVERY_RELEASES_DIR);
    await fsp.mkdir(deliveryReleasesDir, { recursive: true });
    const filePath = path.join(deliveryReleasesDir, `${release.id}.json`);
    await fsp.writeFile(filePath, JSON.stringify(release, null, 2));

    const indexPath = path.join(this.deliveryDir, DELIVERY_INDEX_FILE);
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

  private async readActiveReleaseId(): Promise<string | null> {
    const indexPath = path.join(this.deliveryDir, DELIVERY_INDEX_FILE);
    try {
      const payload = await fsp.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(payload) as { activeReleaseId?: string };
      return parsed.activeReleaseId ?? null;
    } catch {
      return null;
    }
  }

  private async readFromDelivery(id: string): Promise<StoredRelease> {
    const deliveryReleasesDir = path.join(this.deliveryDir, DELIVERY_RELEASES_DIR);
    const filePath = path.join(deliveryReleasesDir, `${id}.json`);
    const payload = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(payload) as StoredRelease;
  }
}

import { fetch } from 'undici';

const AUTHORING_URL = process.env.AUTHORING_URL ?? 'http://localhost:4101';
const PUBLICATION_URL = process.env.PUBLICATION_URL ?? 'http://localhost:4103';
const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:4104';

const authHeaders = process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {};
const jsonHeaders = { 'content-type': 'application/json', ...authHeaders };

async function createPage() {
  const payload = {
    path: `/demo-${Date.now()}`,
    title: 'Demo Landing',
    template: 'campaign-landing',
    locale: 'en-AU',
    components: [
      {
        componentKey: 'hero-banner',
        props: { headline: 'Welcome demo', image: 'asset://placeholder' }
      }
    ],
    seo: { canonical: 'https://bank.example/demo' }
  };

  const response = await fetch(`${AUTHORING_URL}/v1/pages`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to create page: ${response.status} ${await response.text()}`);
  }

  const page = await response.json();
  return page as { id: string; path: string; locale: string; title: string };
}

async function requestRelease(pageId: string) {
  const body = {
    pageIds: [pageId],
    name: `demo-${pageId.slice(0, 8)}`,
    notes: 'Automated demo release'
  };

  const response = await fetch(`${AUTHORING_URL}/v1/releases`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to request release: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function promoteRelease(releaseId: string) {
  const response = await fetch(`${PUBLICATION_URL}/v1/releases/${releaseId}/promote`, {
    method: 'POST',
    headers: authHeaders
  });

  if (!response.ok) {
    throw new Error(`Failed to promote release ${releaseId}: ${response.status}`);
  }

  return response.json();
}

async function fetchDelivery(path: string, locale: string) {
  const response = await fetch(
    `${DELIVERY_URL}/v1/delivery/pages/by-path?path=${encodeURIComponent(path)}&locale=${locale}`,
    { headers: authHeaders }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch delivery content: ${response.status}`);
  }

  return response.json();
}

async function main() {
  console.log('Creating draft page...');
  const page = await createPage();
  console.log('Draft page created', page);

  console.log('Requesting release from authoring...');
  const release = await requestRelease(page.id);
  console.log('Release queued', release.id);

  console.log('Promoting release...');
  await promoteRelease(release.id);
  console.log('Release promoted');

  console.log('Fetching content from delivery tier...');
  const delivery = await fetchDelivery(page.path, page.locale);
  console.log('Delivered content', delivery);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

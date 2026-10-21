import assert from 'node:assert/strict';
import { setupNetwork } from '../src/net.ts';
import { closeDatabase, openDatabase } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildTools } from '../src/agents/tools.ts';
import { setSearchSettings } from '../src/settings.ts';

// Explicit integration check: real Docker service, upstream engines and source
// pages. No fetch mocks, no credentials and no writes to the user's database.
setupNetwork();
await openDatabase({ memory: true });
try {
  await setSearchSettings({ provider: 'auto' });
  const created = await createAgent({ name: 'Search smoke test' });
  const agent = (await getAgent(created.id))!;
  const tools = buildTools({ agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn: true, depth: 0, tz: 'Europe/Paris' });
  const options = { toolCallId: 'smoke', messages: [], context: {} };
  const queries = [
    'OpenRouter latest updates October 2026',
    'OpenRouter changelog',
    'Hognoul Awans coordinates',
    'weather Hognoul Awans today',
  ];
  let officialBlog: string | undefined;
  for (const query of queries) {
    const out = await tools.web_search.execute!({ query, limit: 10 }, options) as any;
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.provider, 'searxng');
    assert.match(out.instance, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(out.results.length > 0, `No real results for ${query}`);
    const topic = query.startsWith('OpenRouter') ? /openrouter/i : /hognoul|awans/i;
    assert.ok(out.results.some((r: any) => topic.test(`${r.title} ${r.snippet}`)), `No matching topic for ${query}`);
    for (const r of out.results) {
      const url = new URL(r.url);
      if (url.hostname === 'openrouter.ai' && url.pathname.startsWith('/blog')) officialBlog ??= r.url;
    }
    console.log(`PASS ${JSON.stringify(query)}: ${out.results.length} results; first: ${out.results[0].url}`);
  }
  assert.ok(officialBlog, 'No official OpenRouter blog found in real search results');
  const page = await tools.web_fetch.execute!({ url: officialBlog }, options) as any;
  assert.equal(page.ok, true, JSON.stringify(page));
  assert.equal(page.status, 200);
  assert.match(page.title, /openrouter/i);
  assert.ok(page.untrusted_content.length > 200);
  console.log(`PASS official source read: ${officialBlog} (HTTP ${page.status}, ${page.untrusted_content.length} characters)`);
  const missing = await tools.web_fetch.execute!({ url: 'https://openrouter.ai/changelog' }, options) as any;
  assert.equal(missing.ok, false, '404 page incorrectly reported as a successful tool result');
  assert.match(missing.error, /404/);
  console.log('PASS missing changelog: HTTP 404 reported as a tool error');
} finally {
  await closeDatabase();
}

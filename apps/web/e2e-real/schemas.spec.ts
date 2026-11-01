import { expect, test } from '@playwright/test';

test.describe('real stack: published JSON Schemas', () => {
  test('the API serves them to anyone as plain JSON files, shown in the browser rather than downloaded', async ({ request }) => {
    for (const name of ['program-v1.json', 'to-platform.json', 'to-program.json']) {
      const response = await request.get(`/schemas/v1/${name}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
      expect(response.headers()['content-disposition']).toBeUndefined();
      expect(await response.json()).toMatchObject({ $schema: expect.stringContaining('json-schema.org'), $id: name });
    }
  });
});

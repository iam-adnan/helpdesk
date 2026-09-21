import api from '../api';

describe('api response interceptor', () => {
  it('normalizes a network error (no response) into a friendly message', async () => {
    const handler = (api.interceptors.response as any).handlers[0].rejected;
    await expect(handler({})).rejects.toMatchObject({
      response: { status: 0, data: { detail: expect.stringContaining('Cannot connect to server') } },
    });
  });

  it('converts an HTML error body (e.g. nginx 502 page) into a JSON detail message', async () => {
    const handler = (api.interceptors.response as any).handlers[0].rejected;
    const error = {
      config: {},
      response: { status: 502, headers: {}, data: '<html>502 Bad Gateway</html>' },
    };
    await expect(handler(error)).rejects.toMatchObject({
      response: { data: { detail: expect.stringContaining('Server error (502)') } },
    });
  });
});

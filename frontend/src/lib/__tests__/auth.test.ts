import { useAuth } from '../auth';
import api from '../api';

jest.mock('../api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('useAuth store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuth.setState({ user: null, loading: true });
    jest.clearAllMocks();
  });

  it('login stores tokens/user and updates state', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { tokens: { access: 'a', refresh: 'r' }, user: { id: '1', email: 'x@mindstormstudios.com' } },
    } as any);

    await useAuth.getState().login('x@mindstormstudios.com', 'pw');

    expect(localStorage.getItem('tokens')).toContain('access');
    expect(useAuth.getState().user?.email).toBe('x@mindstormstudios.com');
  });

  it('login throws when server response is missing tokens', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} } as any);
    await expect(useAuth.getState().login('x@mindstormstudios.com', 'pw')).rejects.toThrow('Invalid server response.');
  });

  it('logout clears storage and state', () => {
    localStorage.setItem('tokens', '{}');
    localStorage.setItem('user', '{}');
    useAuth.setState({ user: { id: '1' } as any });

    // jsdom throws on navigation; stub it out for this test
    delete (window as any).location;
    (window as any).location = { href: '' };

    useAuth.getState().logout();

    expect(localStorage.getItem('tokens')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('loadUser recovers a valid stored user', () => {
    localStorage.setItem('user', JSON.stringify({ id: '2', email: 'y@mindstormstudios.com' }));
    useAuth.getState().loadUser();
    expect(useAuth.getState().user?.email).toBe('y@mindstormstudios.com');
    expect(useAuth.getState().loading).toBe(false);
  });

  it('loadUser clears corrupted storage instead of throwing', () => {
    localStorage.setItem('user', '{not-json');
    useAuth.getState().loadUser();
    expect(useAuth.getState().user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});

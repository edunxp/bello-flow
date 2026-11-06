import { ResetToken } from './reset-token';
describe('reset token lifecycle', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));
  it('captures canonical synthetic token and immediately replaces URL', () => {
    const synthetic = 'A'.repeat(43);
    window.history.replaceState(null, '', '/reset-password#token=' + synthetic);
    const vault = new ResetToken();
    expect(window.location.hash).toBe('');
    expect(vault.read()).toBe(synthetic);
    vault.clear();
    expect(vault.read()).toBe('');
  });
  it.each([
    '',
    '#token=bad',
    '#token=' + 'A'.repeat(42) + 'B',
    '#token=' + 'A'.repeat(43) + '&extra=1',
  ])('rejects malformed fragments without retaining them', (fragment) => {
    window.history.replaceState(null, '', '/reset-password' + fragment);
    expect(new ResetToken().read()).toBe('');
    expect(window.location.hash).toBe('');
  });
  it('does not collect fragments on unrelated routes', () => {
    window.history.replaceState(null, '', '/login#token=' + 'A'.repeat(43));
    expect(new ResetToken().read()).toBe('');
  });
});

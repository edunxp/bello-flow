import { ResetToken } from './reset-token';
describe('reset token lifecycle', () => {
  const vaults: ResetToken[] = [];
  function create() {
    const vault = new ResetToken();
    vaults.push(vault);
    return vault;
  }
  afterEach(() => {
    vaults.forEach((vault) => vault.ngOnDestroy());
    vaults.length = 0;
  });
  afterEach(() => window.history.replaceState(null, '', '/'));
  it('captures canonical synthetic token and immediately replaces URL', () => {
    const synthetic = 'A'.repeat(43);
    window.history.replaceState(null, '', '/reset-password#token=' + synthetic);
    const vault = create();
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
    expect(create().read()).toBe('');
    expect(window.location.hash).toBe('');
  });
  it.each(['hashchange', 'popstate'])(
    'recaptures subsequent same-document links before normal listeners (%s)',
    (event) => {
      window.history.replaceState(null, '', '/reset-password');
      const vault = create();
      let observed = '';
      const observer = () => {
        observed = window.location.hash;
      };
      window.addEventListener(event, observer);
      const synthetic = 'A'.repeat(43);
      window.history.replaceState(null, '', '/reset-password#token=' + synthetic);
      window.dispatchEvent(new Event(event));
      expect(observed).toBe('');
      expect(vault.read()).toBe(synthetic);
      expect(vault.generation()).toBe(1);
      vault.clear('different-token');
      expect(vault.read()).toBe(synthetic);
      window.removeEventListener(event, observer);
    },
  );
  it('does not collect fragments on unrelated routes', () => {
    window.history.replaceState(null, '', '/login#token=' + 'A'.repeat(43));
    expect(create().read()).toBe('');
  });
});

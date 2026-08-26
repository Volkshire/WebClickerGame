/**
 * Developer-access flag for the Debug popout (sessionStorage key). Not a
 * save key: it never touches game progress and dies with the tab.
 */
const DEV_ACCESS_KEY = 'webclickergame.dev';

export class InitScreen {
  private readonly items = new Map<string, HTMLElement>();
  private readonly infoItems = new Map<string, HTMLElement>();
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly panel: HTMLElement | null;
  private readonly toggle: HTMLButtonElement | null;
  private devAccess = false;

  constructor(root: ParentNode) {
    const list = root.querySelector<HTMLElement>('.status-list');
    if (list === null) throw new Error('.status-list element not found');
    this.list = list;

    for (const el of root.querySelectorAll<HTMLElement>('.status-item')) {
      const key = el.dataset.status;
      if (key !== undefined) this.items.set(key, el);
    }

    const detail = root.querySelector<HTMLElement>('.status-detail');
    if (detail === null) throw new Error('.status-detail element not found');
    this.detail = detail;

    this.panel = root.querySelector<HTMLElement>('#diagnostics');
    this.toggle = root.querySelector<HTMLButtonElement>('#diagnostics-toggle');
    this.toggle?.addEventListener('click', () => this.toggleDiagnostics());

    // Developer access is deliberately ungated (no auth, by design): the
    // Debug popout stays invisible to players until either the shortcut or
    // the URL param unlocks it for this tab session.
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyD') {
        // Chrome owns Ctrl+Shift+D (bookmark all tabs); keep it in-page.
        event.preventDefault();
        this.grantDevAccess();
        this.toggleDiagnostics();
      }
    });

    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      // Remember the unlock so reloads/navigation in this tab keep access
      // without re-appending the param; closing the tab revokes it.
      try {
        sessionStorage.setItem(DEV_ACCESS_KEY, '1');
      } catch {
        // Storage blocked: the param itself still unlocks this page load.
      }
      this.grantDevAccess();
    } else if (sessionStorage.getItem(DEV_ACCESS_KEY) === '1') {
      this.grantDevAccess();
    }
  }

  markReady(key: string): void {
    this.items.get(key)?.classList.add('is-ok');
  }

  /**
   * Creates or updates a diagnostics row (e.g. origin, storage health).
   * `ok === false` marks the row with the failure style.
   */
  setInfo(key: string, text: string, ok = true): void {
    let item = this.infoItems.get(key);
    if (item === undefined) {
      item = document.createElement('li');
      item.className = 'status-item status-info';
      item.dataset['info'] = key;
      this.list.appendChild(item);
      this.infoItems.set(key, item);
    }
    item.textContent = text;
    item.classList.toggle('is-bad', !ok);
    item.classList.toggle('is-ok', ok);
  }

  setDetail(text: string): void {
    this.detail.textContent = text;
  }

  toggleDiagnostics(): void {
    if (this.panel === null || this.toggle === null) return;
    const hidden = this.panel.toggleAttribute('hidden');
    this.toggle.setAttribute('aria-expanded', String(!hidden));
  }

  /** Reveals the 🐞 mouse toggle; idempotent. Players never see it without this. */
  private grantDevAccess(): void {
    if (this.devAccess) return;
    this.devAccess = true;
    this.toggle?.removeAttribute('hidden');
  }
}

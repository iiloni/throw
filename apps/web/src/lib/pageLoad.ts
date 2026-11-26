/**
 * A full page load, as a change of account needs: collections open one user's database when
 * the app starts (ADR 0016). Kept apart so tests can see where the app would go.
 */
export const loadPage = (url: string | URL) => window.location.assign(url);

export const reloadPage = () => window.location.reload();
